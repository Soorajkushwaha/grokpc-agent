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



async def write_silent_audio(dest: Path, seconds: float = 4.0) -> None:
    """Generate a short silent MP3 with ffmpeg so DRY_RUN / offline boxes still work."""
    import shutil

    dest.parent.mkdir(parents=True, exist_ok=True)
    if not shutil.which("ffmpeg"):
        # Minimal valid-ish MP3 header + silence is hard; write a wav instead.
        import wave, struct
        dest_wav = dest.with_suffix(".wav")
        with wave.open(str(dest_wav), "w") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(16000)
            w.writeframes(b"\x00\x00" * int(16000 * seconds))
        if dest.suffix.lower() != ".wav":
            dest.write_bytes(dest_wav.read_bytes())
        return
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"anullsrc=r=16000:cl=mono",
        "-t", str(max(1.0, seconds)),
        "-c:a", "libmp3lame", "-q:a", "9",
        str(dest),
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    _out, err = await proc.communicate()
    if proc.returncode != 0 or not dest.is_file():
        raise RuntimeError(err.decode("utf-8", "replace")[-800:] or "ffmpeg silent audio failed")


async def synthesize_voice_safe(script: str, lang: str, dest: Path, log: Optional[LogFn] = None) -> str:
    """Phase 1 voiceover: Gemini TTS (opt-in) -> gTTS -> silent ffmpeg (DRY_RUN / offline)."""
    from config import DRY_RUN

    dest.parent.mkdir(parents=True, exist_ok=True)
    if DRY_RUN:
        await _emit(log, "action", "Voiceover", "DRY_RUN silent audio (no gTTS network call)")
        await write_silent_audio(dest, seconds=max(3.0, min(12.0, len(script or "") / 12)))
        return "dry_run"
    try:
        return await synthesize_voice(script, lang, dest, log=log)
    except Exception as exc:
        logger.warning("Voiceover failed (%s); writing silent audio", exc)
        await _emit(log, "system", "TTS fallback", f"{exc}; silent audio so edit can continue")
        await write_silent_audio(dest, seconds=6.0)
        return "silent"


def _escape_drawtext(text: str) -> str:
    # ffmpeg drawtext is picky: escape \\, :, ', %
    cleaned = (text or "").replace("\\", " ").replace(":", " ").replace("'", "").replace("%", " ")
    cleaned = cleaned.replace("\n", " ")[:80]
    return cleaned




async def media_duration(path: Optional[Path]) -> float:
    """Return duration in seconds via ffprobe, or 0 if unknown."""
    import shutil

    if not path or not Path(path).is_file():
        return 0.0
    if not shutil.which("ffprobe"):
        return 0.0
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "csv=p=0",
        str(path),
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    out, _err = await proc.communicate()
    try:
        return max(0.0, float((out or b"").decode("utf-8", "replace").strip() or 0))
    except ValueError:
        return 0.0


async def _normalize_clip(
    src: Path,
    dest: Path,
    size: str,
    target_dur: Optional[float] = None,
) -> bool:
    """Scale/pad a clip to `size`, drop audio, optionally loop/trim to target_dur."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    w, h = size.split("x")
    vf = (
        f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
        f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1,format=yuv420p"
    )
    src_dur = await media_duration(src)
    inputs: list[str] = ["-i", str(src)]
    if target_dur and src_dur and src_dur < (target_dur - 0.15):
        inputs = ["-stream_loop", "-1", "-i", str(src)]
    cmd = [
        "ffmpeg", "-y",
        *inputs,
        "-vf", vf,
        "-an",
        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
    ]
    if target_dur and target_dur > 0:
        cmd += ["-t", f"{target_dur:.3f}"]
    cmd.append(str(dest))
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    _o, err = await proc.communicate()
    if proc.returncode != 0 or not dest.is_file() or dest.stat().st_size < 500:
        logger.info("normalize %s failed: %s", src.name, (err or b"").decode("utf-8", "replace")[-300:])
        return False
    return True


async def assemble_clips(
    clips: list[Path],
    *,
    audio_path: Optional[Path],
    dest: Path,
    size: str,
    duration_seconds: int,
    log: Optional[LogFn] = None,
) -> dict[str, Any]:
    """Concat/scale clips, loop or trim to the voiceover, overlay the voiceover.

    Each clip is re-encoded to the channel aspect so mixed resolutions/codecs
    still concat cleanly. If the joined picture is shorter than the voiceover
    it is looped; if longer, it is trimmed. On any failure the caller falls
    back to the image/title-card path.
    """
    import shutil

    clips = [Path(c) for c in clips if Path(c).is_file()]
    if not clips:
        raise RuntimeError("no clips to assemble")

    work = dest.parent / f".work_{dest.stem}"
    work.mkdir(parents=True, exist_ok=True)
    try:
        audio_dur = await media_duration(audio_path) if audio_path else 0.0
        target = audio_dur if audio_dur >= 1 else float(max(int(duration_seconds), 8))

        # Give each clip an even slice of the voiceover (loop or trim).
        per = target / max(len(clips), 1)
        norms: list[Path] = []
        for i, src in enumerate(clips):
            n = work / f"n{i:02d}.mp4"
            ok = await _normalize_clip(src, n, size, target_dur=per)
            if ok:
                norms.append(n)
        if not norms:
            raise RuntimeError("could not normalize any clip")

        lst = work / "concat.txt"
        lst.write_text("".join(f"file '{n.resolve()}'\n" for n in norms), encoding="utf-8")
        joined = work / "joined.mp4"
        cmd = [
            "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst),
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an",
            "-movflags", "+faststart",
            str(joined),
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        _o, err = await proc.communicate()
        if proc.returncode != 0 or not joined.is_file():
            raise RuntimeError((err or b"").decode("utf-8", "replace")[-800:] or "concat failed")

        joined_dur = await media_duration(joined) or per * len(norms)
        audio_args: list[str] = []
        map_args = ["-map", "0:v"]
        if audio_path and Path(audio_path).is_file():
            audio_args = ["-i", str(audio_path)]
            map_args += ["-map", "1:a", "-c:a", "aac", "-b:a", "128k"]
        loop_args: list[str] = []
        if joined_dur < target - 0.2:
            loop_args = ["-stream_loop", "-1"]

        cmd = [
            "ffmpeg", "-y",
            *loop_args, "-i", str(joined),
            *audio_args,
            *map_args,
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-t", f"{target:.3f}",
            "-movflags", "+faststart",
            str(dest),
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        _o, err = await proc.communicate()
        if proc.returncode != 0 or not dest.is_file() or dest.stat().st_size < 500:
            raise RuntimeError((err or b"").decode("utf-8", "replace")[-800:] or "mux failed")

        await _emit(log, "system", "Video ready", f"Saved to {dest}")
        record_usage(task_type="video", status="ok", details=str(dest), provider="ffmpeg", model="clips")
        return {"status": "success", "video_path": str(dest), "engine": "ffmpeg-clips"}
    finally:
        shutil.rmtree(work, ignore_errors=True)


async def assemble_video(
    *,
    title: str,
    audio_path: Optional[Path] = None,
    images: Optional[list[Path]] = None,
    clips: Optional[list[Path]] = None,
    duration_seconds: int = 20,
    aspect: str = "16:9",
    log: Optional[LogFn] = None,
    dest: Optional[Path] = None,
) -> dict[str, Any]:
    """FFmpeg auto-edit fallback (Phase 1 default editor).

    - If clips are given, concat them and mux the voiceover.
    - Else if images are given, make a simple slideshow + voiceover.
    - Else a color title card + voiceover (same idea as render_video).
    """
    import shutil
    import time as _time

    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg is not installed")

    out = dest
    if out is None:
        stamp = int(_time.time())
        safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in title)[:40] or "video"
        out = output_dir() / f"{safe}_{stamp}.mp4"
    out.parent.mkdir(parents=True, exist_ok=True)

    if aspect == "9:16":
        size = "720x1280"
    elif aspect == "1:1":
        size = "720x720"
    else:
        size = "1280x720"

    await _emit(log, "terminal", "FFmpeg", f"Assembling {out.name} ({size})")

    duration = max(int(duration_seconds), 8)
    audio_args: list[str] = []
    if audio_path and Path(audio_path).is_file():
        audio_args = ["-i", str(audio_path)]

    async def _run(cmd: list[str]) -> tuple[int, str]:
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        _o, err = await proc.communicate()
        return proc.returncode, err.decode("utf-8", "replace")[-1500:]

    clips = [Path(c) for c in (clips or []) if Path(c).is_file()]
    images = [Path(i) for i in (images or []) if Path(i).is_file()]

    if clips:
        try:
            return await assemble_clips(
                clips,
                audio_path=Path(audio_path) if audio_path else None,
                dest=out,
                size=size,
                duration_seconds=duration,
                log=log,
            )
        except Exception as exc:
            logger.warning("clip assembly failed, falling back: %s", exc)
            await _emit(log, "system", "FFmpeg clips", f"clip stitch fail ({exc}); fallback")

    if images:
        # One image held for `duration / n` each, scaled to size.
        per = max(2.0, duration / max(len(images), 1))
        # Use the first image as a simple Ken-Burns-less still sequence via lavfi is complex;
        # a reliable path: loop first image, or concat stills.
        first = images[0]
        cmd = [
            "ffmpeg", "-y",
            "-loop", "1", "-t", str(duration), "-i", str(first),
            *audio_args,
            "-vf", f"scale={size}:force_original_aspect_ratio=decrease,pad={size}:(ow-iw)/2:(oh-ih)/2",
            "-c:v", "libx264", "-tune", "stillimage", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k",
            "-shortest", "-movflags", "+faststart",
            str(out),
        ]
        code, err = await _run(cmd)
        if code == 0 and out.is_file():
            await _emit(log, "system", "Video ready", f"Saved to {out}")
            record_usage(task_type="video", status="ok", details=str(out), provider="ffmpeg", model="slideshow")
            return {"status": "success", "video_path": str(out), "engine": "ffmpeg-image"}

    label = _escape_drawtext(title)
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"color=c=0x0a101f:s={size}:d={duration}",
        *audio_args,
        "-filter_complex",
        f"drawtext=text='{label}':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=(h-text_h)/2",
        "-c:v", "libx264", "-tune", "stillimage", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-shortest", "-movflags", "+faststart",
        str(out),
    ]
    code, err = await _run(cmd)
    if code != 0:
        cmd = [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", f"color=c=0x0a101f:s={size}:d={duration}",
            *audio_args,
            "-c:v", "libx264", "-tune", "stillimage", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k",
            "-shortest", "-movflags", "+faststart",
            str(out),
        ]
        code, err = await _run(cmd)
        if code != 0:
            raise RuntimeError(err or "ffmpeg title-card failed")

    await _emit(log, "system", "Video ready", f"Saved to {out}")
    record_usage(task_type="video", status="ok", details=str(out), provider="ffmpeg", model="titlecard")
    return {"status": "success", "video_path": str(out), "engine": "ffmpeg-titlecard"}
