"""Voiceover chain: Gemini TTS → edge-tts → gTTS, with sentence timings.

Gemini TTS (primary, when a key is present) returns raw PCM at 24 kHz
s16le mono, which we wrap in a WAV header. Subtitle cues come from
synthesizing each sentence (or planner scene narration) separately and
measuring its duration, then padding with silence for dramatic pauses.
SSML is not used — newer edge-tts dropped it.

Fallback order: Gemini TTS (Charon, then Fenrir) → edge-tts
hi-IN-MadhurNeural → gTTS. DRY_RUN writes silent audio and synthetic cues.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
import struct
import wave
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

logger = logging.getLogger("grokpc.voiceover")

LogFn = Callable[[dict[str, Any]], Awaitable[None]]

# Default Gemini TTS models (free-tier). Override with GEMINI_TTS_MODEL.
GEMINI_TTS_MODELS = (
    "gemini-3.8-flash-tts",
    "gemini-2.5-flash-preview-tts",
)
GEMINI_TTS_VOICES = ("Charon", "Fenrir")
DEFAULT_EDGE_VOICE = "hi-IN-MadhurNeural"
DEFAULT_EDGE_RATE = "-8%"
DEFAULT_EDGE_PITCH = "-8Hz"
DEFAULT_PAUSE_SEC = 0.45
PCM_RATE = 24000


async def _emit(log: Optional[LogFn], typ: str, title: str, message: str) -> None:
    if log:
        await log({"type": typ, "title": title, "message": message})


def _cfg(name: str, default: str = "") -> str:
    import os
    return (os.getenv(name) or default).strip()


def _cfg_bool(name: str, default: bool) -> bool:
    import os
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def cues_sidecar(audio_path: Path) -> Path:
    p = Path(audio_path)
    return p.with_name(p.stem + ".cues.json")


def save_cues(audio_path: Path, cues: list[dict[str, Any]]) -> Path:
    dest = cues_sidecar(audio_path)
    dest.write_text(json.dumps(cues, ensure_ascii=False, indent=2), encoding="utf-8")
    return dest


def load_cues(audio_path: Optional[Path]) -> list[dict[str, Any]]:
    if not audio_path:
        return []
    dest = cues_sidecar(Path(audio_path))
    if not dest.is_file():
        return []
    try:
        data = json.loads(dest.read_text(encoding="utf-8"))
    except Exception:
        return []
    if not isinstance(data, list):
        return []
    out = []
    for raw in data:
        if not isinstance(raw, dict):
            continue
        try:
            start = float(raw.get("start") or 0)
            end = float(raw.get("end") or 0)
        except (TypeError, ValueError):
            continue
        text = str(raw.get("text") or "").strip()
        if text and end > start:
            out.append({"start": start, "end": end, "text": text})
    return out


def split_sentences(script: str) -> list[str]:
    """Split Hindi/English narration on danda, punctuation, and newlines."""
    text = (script or "").replace("\r\n", "\n").strip()
    if not text:
        return []
    # Keep abbreviations from splitting (rare in Hindi VO).
    text = re.sub(r"\s+", " ", text)
    parts = re.split(r"(?<=[।.!?؟…])\s+|\n+", text)
    cleaned: list[str] = []
    buf = ""
    for part in parts:
        p = part.strip()
        if not p:
            continue
        # Merge very short fragments (e.g. "हाँ।") into the previous/next line.
        if buf:
            p = (buf + " " + p).strip()
            buf = ""
        if len(p) < 8 and cleaned:
            cleaned[-1] = (cleaned[-1] + " " + p).strip()
        elif len(p) < 8:
            buf = p
        else:
            cleaned.append(p)
    if buf:
        if cleaned:
            cleaned[-1] = (cleaned[-1] + " " + buf).strip()
        else:
            cleaned.append(buf)
    return cleaned or ([text] if text else [])


def wrap_pcm_to_wav(
    data: bytes,
    dest: Path,
    *,
    rate: int = PCM_RATE,
    channels: int = 1,
    mime: str = "",
) -> Path:
    """Wrap Gemini TTS bytes in a WAV file. Accepts raw PCM, WAV, or MP3."""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    mime_l = (mime or "").lower()
    if not data:
        raise ValueError("empty audio data")

    m = re.search(r"rate=(\d+)", mime_l)
    if m:
        rate = int(m.group(1))

    if data[:4] == b"RIFF":
        dest.write_bytes(data)
        return dest

    # MP3 or other encoded — write as-is with a matching suffix, convert later.
    if (
        data[:3] == b"ID3"
        or data[:2] in {b"\xff\xfb", b"\xff\xf3", b"\xff\xf2", b"\xff\xfa"}
        or "mpeg" in mime_l
        or "mp3" in mime_l
    ):
        mp3 = dest.with_suffix(".mp3") if dest.suffix.lower() != ".mp3" else dest
        mp3.write_bytes(data)
        if mp3 != dest:
            # Leave a pointer file? Caller prefers wav. Convert if ffmpeg exists.
            _sync_ffmpeg_convert(mp3, dest, rate)
        return dest

    if isinstance(data, str):  # defensive
        data = base64.b64decode(data)

    # Raw PCM s16le.
    sampwidth = 2
    if "f32" in mime_l or "float" in mime_l:
        # Convert f32le to s16le
        n = len(data) // 4
        floats = struct.unpack("<" + "f" * n, data[: n * 4])
        data = struct.pack("<" + "h" * n, *[max(-32768, min(32767, int(x * 32767))) for x in floats])

    with wave.open(str(dest), "wb") as w:
        w.setnchannels(max(1, channels))
        w.setsampwidth(sampwidth)
        w.setframerate(int(rate) or PCM_RATE)
        w.writeframes(data)
    return dest


def _sync_ffmpeg_convert(src: Path, dest: Path, rate: int) -> None:
    import shutil
    import subprocess

    if not shutil.which("ffmpeg"):
        dest.write_bytes(src.read_bytes())
        return
    cmd = [
        "ffmpeg", "-y", "-i", str(src),
        "-ac", "1", "-ar", str(rate),
        "-c:a", "pcm_s16le",
        str(dest),
    ]
    subprocess.run(cmd, capture_output=True, check=False)


def _decode_inline(data: Any) -> bytes:
    if data is None:
        return b""
    if isinstance(data, bytes):
        return data
    if isinstance(data, (bytearray, memoryview)):
        return bytes(data)
    if isinstance(data, str):
        try:
            return base64.b64decode(data)
        except Exception:
            return data.encode("utf-8", "replace")
    return bytes(data)


@dataclass
class VoiceResult:
    engine: str
    path: Path
    cues: list[dict[str, Any]] = field(default_factory=list)
    duration: float = 0.0
    note: str = ""


def _style_prompt(sentence: str, lang: str) -> str:
    lang_l = (lang or "Hindi").lower()
    spoken = "Hindi" if lang_l.startswith("hi") else ("English" if lang_l.startswith("en") else lang)
    return (
        "Narrate the text between the <narration> tags and nothing else. "
        f"Language: {spoken}. "
        "Style: a deep, male, suspenseful horror storyteller. "
        "Speak slowly and clearly, with a short dramatic pause, "
        "in a quiet whisper-like intensity, taking about eight to ten seconds. "
        "Do not stretch individual words, do not translate, do not add words, "
        "do not introduce yourself.\n"
        f"<narration>\n{sentence.strip()}\n</narration>"
    )


def _gemini_models() -> list[str]:
    primary = _cfg("GEMINI_TTS_MODEL", GEMINI_TTS_MODELS[0])
    primary = primary.removeprefix("models/")
    out: list[str] = []
    for m in (primary, *GEMINI_TTS_MODELS):
        m = (m or "").removeprefix("models/").strip()
        if m and m not in out:
            out.append(m)
    return out


def _gemini_voices() -> list[str]:
    primary = _cfg("GEMINI_TTS_VOICE", GEMINI_TTS_VOICES[0]) or GEMINI_TTS_VOICES[0]
    out: list[str] = []
    for v in (primary, *GEMINI_TTS_VOICES):
        if v and v not in out:
            out.append(v)
    return out


async def _gemini_tts_one(
    text: str,
    dest: Path,
    *,
    lang: str,
    model: str,
    voice: str,
) -> Path:
    from google import genai
    from google.genai import types

    from config import GEMINI_API_KEY

    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not set")

    client = genai.Client(api_key=GEMINI_API_KEY)
    speech_kwargs: dict[str, Any] = {
        "voice_config": types.VoiceConfig(
            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice)
        )
    }
    # language_code is supported on some SDK versions only.
    try:
        speech = types.SpeechConfig(**speech_kwargs, language_code="hi-IN" if (lang or "").lower().startswith("hi") else "en-US")
    except (TypeError, ValueError):
        speech = types.SpeechConfig(**speech_kwargs)

    response = await client.aio.models.generate_content(
        model=model,
        contents=_style_prompt(text, lang),
        config=types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=speech,
        ),
    )
    data = b""
    mime = ""
    try:
        parts = response.candidates[0].content.parts
    except Exception as exc:
        raise RuntimeError(f"Gemini TTS returned no audio: {exc}") from exc
    for part in parts or []:
        inline = getattr(part, "inline_data", None) or getattr(part, "inlineData", None)
        if inline is None:
            continue
        data = _decode_inline(getattr(inline, "data", None))
        mime = str(getattr(inline, "mime_type", None) or getattr(inline, "mimeType", None) or "")
        if data:
            break
    if not data:
        raise RuntimeError("Gemini TTS returned empty audio")

    dest = dest.with_suffix(".wav")
    wrap_pcm_to_wav(data, dest, rate=PCM_RATE, mime=mime)

    try:
        from db import record_usage

        usage = getattr(response, "usage_metadata", None) or getattr(response, "usageMetadata", None)
        tokens_in = int(getattr(usage, "prompt_token_count", 0) or getattr(usage, "promptTokenCount", 0) or 0) if usage else 0
        tokens_out = int(getattr(usage, "candidates_token_count", 0) or getattr(usage, "candidatesTokenCount", 0) or 0) if usage else 0
        record_usage(
            task_type="tts",
            status="ok",
            details=f"{model}/{voice}",
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            provider="gemini",
            model=model,
            kind="tts",
            cost_usd=0.0,
        )
    except Exception:
        pass
    return dest


async def media_duration(path: Optional[Path]) -> float:
    import shutil

    if not path or not Path(path).is_file():
        return 0.0
    if not shutil.which("ffprobe"):
        # WAV fallback: header only.
        p = Path(path)
        if p.suffix.lower() == ".wav":
            try:
                with wave.open(str(p), "rb") as w:
                    frames = w.getnframes()
                    rate = w.getframerate() or 1
                    return max(0.0, frames / float(rate))
            except Exception:
                return 0.0
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


async def write_silent_audio(dest: Path, seconds: float = 4.0, *, rate: int = 16000) -> None:
    """Generate a short silent MP3 (or WAV) so DRY_RUN / offline boxes still work."""
    import shutil

    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    seconds = max(1.0, float(seconds))
    if not shutil.which("ffmpeg"):
        dest_wav = dest if dest.suffix.lower() == ".wav" else dest.with_suffix(".wav")
        n = int(rate * seconds)
        with wave.open(str(dest_wav), "w") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(rate)
            w.writeframes(b"\x00\x00" * n)
        if dest != dest_wav:
            dest.write_bytes(dest_wav.read_bytes())
        return
    codec = ["-c:a", "libmp3lame", "-q:a", "9"] if dest.suffix.lower() == ".mp3" else ["-c:a", "pcm_s16le"]
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"anullsrc=r={rate}:cl=mono",
        "-t", f"{seconds:.3f}",
        *codec,
        str(dest),
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    _out, err = await proc.communicate()
    if proc.returncode != 0 or not dest.is_file():
        raise RuntimeError(err.decode("utf-8", "replace")[-800:] or "ffmpeg silent audio failed")


async def _write_silence_wav(dest: Path, seconds: float, rate: int = PCM_RATE) -> Path:
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    seconds = max(0.05, float(seconds))
    import shutil

    if shutil.which("ffmpeg"):
        cmd = [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", f"anullsrc=r={rate}:cl=mono",
            "-t", f"{seconds:.3f}",
            "-c:a", "pcm_s16le",
            str(dest),
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        await proc.communicate()
        if dest.is_file() and dest.stat().st_size > 44:
            return dest
    n = int(rate * seconds)
    with wave.open(str(dest), "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * n)
    return dest


async def _ffmpeg(cmd: list[str]) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    _o, err = await proc.communicate()
    return proc.returncode, (err or b"").decode("utf-8", "replace")[-1500:]


async def _to_wav(src: Path, dest: Path, rate: int = PCM_RATE) -> Path:
    if src.resolve() == dest.resolve() and src.suffix.lower() == ".wav":
        return dest
    if src.suffix.lower() == ".wav" and src != dest:
        # Still re-encode to a common rate so concat is safe.
        pass
    code, err = await _ffmpeg([
        "ffmpeg", "-y", "-i", str(src),
        "-ac", "1", "-ar", str(rate), "-c:a", "pcm_s16le",
        str(dest),
    ])
    if code != 0 or not dest.is_file():
        raise RuntimeError(err or f"ffmpeg wav convert failed for {src}")
    return dest


async def _concat_wavs(parts: list[Path], dest: Path) -> Path:
    import shutil

    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if len(parts) == 1:
        data = Path(parts[0]).read_bytes()
        dest.write_bytes(data)
        return dest
    lst = dest.parent / f".concat_{dest.stem}.txt"
    lst.write_text("".join(f"file '{Path(p).resolve()}'\n" for p in parts), encoding="utf-8")
    try:
        code, err = await _ffmpeg([
            "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst),
            "-c:a", "pcm_s16le", "-ar", str(PCM_RATE), "-ac", "1",
            str(dest),
        ])
        if code != 0 or not dest.is_file():
            raise RuntimeError(err or "audio concat failed")
        return dest
    finally:
        lst.unlink(missing_ok=True)
        shutil.rmtree = shutil.rmtree  # keep import used? already imported


async def _encode_dest(wav: Path, dest: Path) -> Path:
    dest = Path(dest)
    if dest.suffix.lower() == ".wav":
        if wav.resolve() != dest.resolve():
            dest.write_bytes(Path(wav).read_bytes())
        return dest
    # mp3 / m4a / default
    suf = dest.suffix.lower()
    if suf == ".m4a":
        ac = ["-c:a", "aac", "-b:a", "160k"]
    else:
        if suf != ".mp3":
            dest = dest.with_suffix(".mp3")
        ac = ["-c:a", "libmp3lame", "-q:a", "2"]
    code, err = await _ffmpeg([
        "ffmpeg", "-y", "-i", str(wav),
        "-ar", "24000", "-ac", "1", *ac,
        str(dest),
    ])
    if code != 0 or not dest.is_file():
        # Fall back to just copying the wav next to dest.
        fallback = dest.with_suffix(".wav")
        if wav.resolve() != fallback.resolve():
            fallback.write_bytes(Path(wav).read_bytes())
        logger.warning("encode to %s failed (%s); using %s", dest, err[-200:], fallback)
        return fallback
    return dest


async def _edge_tts_one(text: str, dest: Path, *, lang: str) -> Path:
    try:
        import edge_tts
    except ImportError as exc:
        raise RuntimeError("edge-tts is not installed") from exc

    voice = _cfg("TTS_VOICE", DEFAULT_EDGE_VOICE) or DEFAULT_EDGE_VOICE
    # If the script is English and the default is a Hindi voice, still allow override.
    if not (lang or "").lower().startswith("hi") and voice.startswith("hi-IN") and not _cfg("TTS_VOICE"):
        voice = "en-IN-PrabhatNeural"
    rate = _cfg("TTS_RATE", DEFAULT_EDGE_RATE) or DEFAULT_EDGE_RATE
    pitch = _cfg("TTS_PITCH", DEFAULT_EDGE_PITCH) or DEFAULT_EDGE_PITCH

    communicate = edge_tts.Communicate(text, voice=voice, rate=rate, pitch=pitch)
    audio = bytearray()
    async for chunk in communicate.stream():
        if chunk.get("type") == "audio":
            audio.extend(chunk.get("data") or b"")
    if not audio:
        # Older API: save()
        tmp = dest.with_suffix(".mp3")
        await communicate.save(str(tmp))
        if not tmp.is_file() or tmp.stat().st_size < 100:
            raise RuntimeError("edge-tts returned no audio")
        return await _to_wav(tmp, dest.with_suffix(".wav"))
    tmp = dest.with_suffix(".mp3")
    tmp.write_bytes(bytes(audio))
    return await _to_wav(tmp, dest.with_suffix(".wav"))


def _write_gtts_sync(text: str, lang: str, dest: Path) -> None:
    from gtts import gTTS

    code = "hi" if (lang or "").lower().startswith("hi") else "en"
    tts = gTTS(text=text, lang=code, slow=False)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tts.save(str(dest))


async def _gtts_one(text: str, dest: Path, *, lang: str) -> Path:
    mp3 = dest.with_suffix(".mp3")
    await asyncio.to_thread(_write_gtts_sync, text, lang, mp3)
    if not mp3.is_file() or mp3.stat().st_size < 100:
        raise RuntimeError("gTTS returned no audio")
    return await _to_wav(mp3, dest.with_suffix(".wav"))


def normalize_segments(
    script: str,
    segments: Optional[list[Any]] = None,
) -> list[dict[str, Any]]:
    """Build [{text, min_sec}] from planner scenes or by splitting the script."""
    out: list[dict[str, Any]] = []
    if segments:
        for raw in segments:
            if isinstance(raw, str):
                text, min_sec = raw.strip(), 0.0
            elif isinstance(raw, dict):
                text = str(raw.get("text") or raw.get("narration") or "").strip()
                try:
                    min_sec = float(raw.get("min_sec") or raw.get("duration_sec") or raw.get("duration") or 0)
                except (TypeError, ValueError):
                    min_sec = 0.0
            else:
                continue
            if text:
                out.append({"text": text, "min_sec": max(0.0, min_sec)})
    if not out:
        for s in split_sentences(script):
            out.append({"text": s, "min_sec": 0.0})
    if not out and (script or "").strip():
        out.append({"text": script.strip(), "min_sec": 0.0})
    return out


async def _synth_segments(
    segments: list[dict[str, Any]],
    work: Path,
    one_fn,
    *,
    label: str,
    lang: str,
    log: Optional[LogFn],
    default_pause: float = DEFAULT_PAUSE_SEC,
) -> tuple[Path, list[dict[str, Any]], float]:
    """Synthesize each segment, pad to min_sec, concat, return (wav, cues, dur)."""
    work.mkdir(parents=True, exist_ok=True)
    wavs: list[Path] = []
    cues: list[dict[str, Any]] = []
    t = 0.0
    for i, seg in enumerate(segments):
        text = seg["text"]
        min_sec = float(seg.get("min_sec") or 0)
        part = work / f"s{i:02d}.wav"
        await _emit(log, "action", "TTS", f"{label} segment {i + 1}/{len(segments)}")
        produced = await one_fn(text, part, lang=lang)
        produced = await _to_wav(Path(produced), part)
        spoken = await media_duration(produced)
        if spoken <= 0.05:
            raise RuntimeError(f"{label} segment {i + 1} was empty")
        pad = 0.0
        if min_sec and spoken < min_sec:
            pad = min_sec - spoken
        # Always a short breath between sentences when we are not already padding much.
        pause = 0.0 if pad >= default_pause else (default_pause if i < len(segments) - 1 else min(0.3, default_pause))
        pieces = [produced]
        extra = pad + pause
        if extra >= 0.05:
            sil = work / f"sil{i:02d}.wav"
            await _write_silence_wav(sil, extra)
            pieces.append(sil)
        if len(pieces) > 1:
            padded = work / f"p{i:02d}.wav"
            await _concat_wavs(pieces, padded)
            wavs.append(padded)
        else:
            wavs.append(produced)
        cues.append({
            "start": round(t, 3),
            "end": round(t + spoken, 3),
            "text": text,
        })
        t = t + spoken + extra
    master = work / "master.wav"
    await _concat_wavs(wavs, master)
    dur = await media_duration(master) or t
    return master, cues, dur


async def _try_gemini(
    segments: list[dict[str, Any]],
    work: Path,
    lang: str,
    log: Optional[LogFn],
) -> tuple[Path, list[dict[str, Any]], float, str]:
    last_err: Optional[Exception] = None
    for model in _gemini_models():
        for voice in _gemini_voices():
            async def _one(text: str, dest: Path, *, lang: str, _m=model, _v=voice) -> Path:
                # Retry a single segment once on transient failure.
                err: Optional[Exception] = None
                for attempt in range(2):
                    try:
                        return await _gemini_tts_one(text, dest, lang=lang, model=_m, voice=_v)
                    except Exception as exc:
                        err = exc
                        logger.warning("Gemini TTS %s/%s attempt %s failed: %s", _m, _v, attempt + 1, exc)
                        await asyncio.sleep(0.8 * (attempt + 1))
                raise err or RuntimeError("Gemini TTS failed")

            try:
                await _emit(log, "action", "Gemini TTS", f"{model} voice={voice}")
                # Fresh work dir per attempt so leftovers don't mix.
                attempt_dir = work / f"gemini_{model}_{voice}"
                wav, cues, dur = await _synth_segments(
                    segments, attempt_dir, _one, label=f"Gemini {voice}", lang=lang, log=log
                )
                return wav, cues, dur, f"gemini:{model}:{voice}"
            except Exception as exc:
                last_err = exc
                logger.warning("Gemini TTS %s/%s failed: %s", model, voice, exc)
                await _emit(log, "system", "TTS fallback", f"Gemini {model}/{voice} fail: {exc}")
                continue
    raise RuntimeError(f"Gemini TTS failed: {last_err}")


async def _try_edge(
    segments: list[dict[str, Any]],
    work: Path,
    lang: str,
    log: Optional[LogFn],
) -> tuple[Path, list[dict[str, Any]], float, str]:
    await _emit(log, "action", "edge-tts", f"voice={_cfg('TTS_VOICE', DEFAULT_EDGE_VOICE)}")
    wav, cues, dur = await _synth_segments(
        segments, work / "edge", _edge_tts_one, label="edge-tts", lang=lang, log=log
    )
    return wav, cues, dur, "edge-tts"


async def _try_gtts(
    segments: list[dict[str, Any]],
    work: Path,
    lang: str,
    log: Optional[LogFn],
) -> tuple[Path, list[dict[str, Any]], float, str]:
    await _emit(log, "action", "gTTS", f"Synthesizing free {lang} voiceover")
    wav, cues, dur = await _synth_segments(
        segments, work / "gtts", _gtts_one, label="gTTS", lang=lang, log=log
    )
    return wav, cues, dur, "gtts"


async def synthesize_voice(
    script: str,
    lang: str,
    dest: Path,
    log: Optional[LogFn] = None,
    *,
    segments: Optional[list[Any]] = None,
) -> str:
    """Synthesize `script` (or pre-split `segments`) into `dest`. Returns engine id.

    Also writes a sibling `.cues.json` with sentence timings.
    """
    result = await synthesize_voice_full(script, lang, dest, log=log, segments=segments)
    return result.engine


async def synthesize_voice_full(
    script: str,
    lang: str,
    dest: Path,
    log: Optional[LogFn] = None,
    *,
    segments: Optional[list[Any]] = None,
) -> VoiceResult:
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    segs = normalize_segments(script, segments)
    if not segs:
        raise RuntimeError("empty voiceover script")

    work = dest.parent / f".voice_{dest.stem}"
    work.mkdir(parents=True, exist_ok=True)
    errors: list[str] = []

    use_gemini = _cfg_bool("USE_GEMINI_TTS", True)
    gemini_key = _cfg("GEMINI_API_KEY")
    try:
        from config import GEMINI_API_KEY, USE_GEMINI_TTS
        use_gemini = bool(USE_GEMINI_TTS)
        gemini_key = GEMINI_API_KEY or gemini_key
    except Exception:
        pass

    engines = []
    if use_gemini and gemini_key:
        engines.append(("gemini", _try_gemini))
    engines.append(("edge-tts", _try_edge))
    engines.append(("gtts", _try_gtts))

    last: Optional[Exception] = None
    try:
        for name, fn in engines:
            try:
                wav, cues, dur, engine = await fn(segs, work, lang, log)
                out = await _encode_dest(wav, dest)
                save_cues(out, cues)
                if out != dest and dest.suffix == out.suffix:
                    pass
                # If we encoded next to a different path, copy cues under requested dest too.
                if Path(out) != dest:
                    try:
                        if dest.suffix == out.suffix or dest.suffix.lower() in {".mp3", ".wav", ".m4a"}:
                            # Leave dest pointing at the real file if encode changed suffix.
                            pass
                        save_cues(dest, cues)
                    except Exception:
                        pass
                await _emit(log, "system", "Voiceover", f"{engine} {dur:.1f}s, {len(cues)} cues → {Path(out).name}")
                return VoiceResult(engine=engine, path=Path(out), cues=cues, duration=dur)
            except Exception as exc:
                last = exc
                errors.append(f"{name}: {exc}")
                logger.warning("voice engine %s failed: %s", name, exc)
                await _emit(log, "system", "TTS fallback", f"{name} failed ({exc})")
                continue
        raise RuntimeError("; ".join(errors) or f"all TTS engines failed: {last}")
    finally:
        # Keep work dir on failure for debugging? Clean on success only is nicer.
        # Always clean to avoid filling /data.
        import shutil
        shutil.rmtree(work, ignore_errors=True)


async def synthesize_voice_safe(
    script: str,
    lang: str,
    dest: Path,
    log: Optional[LogFn] = None,
    *,
    segments: Optional[list[Any]] = None,
) -> str:
    """Pipeline entry: DRY_RUN silent audio, else the full fallback chain, else silence."""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)

    dry = False
    try:
        from config import DRY_RUN
        dry = bool(DRY_RUN)
    except Exception:
        dry = _cfg_bool("DRY_RUN", False)

    if dry:
        segs = normalize_segments(script, segments)
        # ~8s default when the planner asked for it, else a short estimate.
        total = 0.0
        cues = []
        t = 0.0
        for seg in segs or [{"text": script or "…", "min_sec": 4}]:
            text = seg.get("text") or "…"
            # Rough 12 chars/sec, respect min_sec.
            est = max(float(seg.get("min_sec") or 0), min(12.0, max(2.0, len(text) / 12)))
            cues.append({"start": round(t, 3), "end": round(t + est * 0.85, 3), "text": text})
            t += est
            total += est
        if total < 3:
            total = 4.0
        await _emit(log, "action", "Voiceover", "DRY_RUN silent audio (no TTS network call)")
        await write_silent_audio(dest, seconds=total)
        save_cues(dest, cues)
        return "dry_run"

    try:
        result = await synthesize_voice_full(script, lang, dest, log=log, segments=segments)
        return result.engine
    except Exception as exc:
        logger.warning("Voiceover failed (%s); writing silent audio", exc)
        await _emit(log, "system", "TTS fallback", f"{exc}; silent audio so edit can continue")
        segs = normalize_segments(script, segments)
        seconds = 6.0
        if segs:
            seconds = max(6.0, sum(max(float(s.get("min_sec") or 0), 3.0) for s in segs))
        await write_silent_audio(dest, seconds=seconds)
        # Still write cues so subtitles have something to show.
        t = 0.0
        cues = []
        per = seconds / max(len(segs), 1)
        for s in segs:
            cues.append({"start": round(t, 3), "end": round(t + per * 0.9, 3), "text": s["text"]})
            t += per
        save_cues(dest, cues)
        return "silent"
