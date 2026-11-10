"""FFmpeg + gTTS video pipeline. Optional Gemini TTS behind USE_GEMINI_TTS."""
from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

from config import (
    GEMINI_API_KEY,
    GEMINI_TTS_MODEL,
    USE_GEMINI_TTS,
    output_dir,
)
from db import record_usage

logger = logging.getLogger("grokpc.video")

LogFn = Callable[[dict[str, Any]], Awaitable[None]]


async def _emit(log: Optional[LogFn], typ: str, title: str, message: str) -> None:
    if log:
        await log({"type": typ, "title": title, "message": message})


def _write_gtts(script: str, lang: str, dest: Path) -> None:
    from gtts import gTTS

    code = "hi" if (lang or "").lower().startswith("hi") else "en"
    tts = gTTS(text=script, lang=code, slow=False)
    tts.save(str(dest))


async def _gemini_tts(script: str, dest: Path) -> dict[str, Any]:
    """Generate speech with Gemini TTS. Verified model id: gemini-3.8-flash-lite-tts."""
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=GEMINI_API_KEY)
    response = await client.aio.models.generate_content(
        model=GEMINI_TTS_MODEL,
        contents=script,
        config=types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Kore")
                )
            ),
        ),
    )
    # google-genai returns inline audio data on the first part when successful
    data = None
    try:
        data = response.candidates[0].content.parts[0].inline_data.data
    except Exception as exc:
        raise RuntimeError(f"Gemini TTS returned no audio: {exc}") from exc
    dest.write_bytes(data)
    usage = getattr(response, "usage_metadata", None)
    tokens_in = int(getattr(usage, "prompt_token_count", 0) or 0) if usage else 0
    tokens_out = int(getattr(usage, "candidates_token_count", 0) or 0) if usage else 0
    rec = record_usage(
        task_type="tts",
        status="ok",
        details=GEMINI_TTS_MODEL,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        provider="gemini",
        model=GEMINI_TTS_MODEL,
        kind="tts",
    )
    return rec


async def synthesize_voice(script: str, lang: str, dest: Path, log: Optional[LogFn] = None) -> str:
    if USE_GEMINI_TTS and GEMINI_API_KEY:
        try:
            await _emit(log, "action", "Gemini TTS", f"Synthesizing with {GEMINI_TTS_MODEL}")
            await _gemini_tts(script, dest)
            return "gemini"
        except Exception as exc:
            logger.warning("Gemini TTS failed, falling back to gTTS: %s", exc)
            await _emit(log, "system", "TTS fallback", f"Gemini TTS failed ({exc}); using free gTTS")
    await _emit(log, "action", "gTTS", f"Synthesizing free {lang} voiceover")
    await asyncio.to_thread(_write_gtts, script, lang, dest)
    return "gtts"


async def render_video(
    *,
    topic: str,
    script: str,
    language: str = "Hindi",
    duration_seconds: int = 15,
    log: Optional[LogFn] = None,
) -> dict[str, Any]:
    out = output_dir()
    stamp = int(time.time())
    safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in topic)[:40] or "video"
    audio = out / f"voice_{stamp}.mp3"
    final = out / f"{safe}_{stamp}.mp4"

    engine = await synthesize_voice(script, language, audio, log=log)
    await _emit(log, "terminal", "FFmpeg", f"Rendering {final.name}")

    # Title card + voiceover. If audio is raw PCM from Gemini (often audio/L16), try ffmpeg anyway;
    # gTTS writes mp3 which ffmpeg handles natively. If Gemini writes raw bytes, we may need -f.
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"color=c=0x0a101f:s=1280x720:d={max(duration_seconds, 8)}",
        "-i", str(audio),
        "-filter_complex",
        f"drawtext=text='{topic.replace(chr(39), '')[:80]}':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=(h-text_h)/2",
        "-c:v", "libx264", "-tune", "stillimage", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-shortest",
        str(final),
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    _out, err = await proc.communicate()
    if proc.returncode != 0:
        # Retry without drawtext (fonts may be missing on a fresh VM)
        cmd = [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", f"color=c=0x0a101f:s=1280x720:d={max(duration_seconds, 8)}",
            "-i", str(audio),
            "-c:v", "libx264", "-tune", "stillimage", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k",
            "-shortest",
            str(final),
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        _out, err = await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError(err.decode("utf-8", "replace")[-1500:])

    await _emit(log, "system", "Video ready", f"Saved to {final}")
    record_usage(task_type="video", status="ok", details=str(final), provider=engine, model=engine)
    return {
        "status": "success",
        "video_path": str(final),
        "audio_path": str(audio),
        "voice_engine": engine,
    }
