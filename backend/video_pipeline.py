"""FFmpeg video pipeline: Gemini/edge-tts/gTTS voice, Ken Burns stills, BGM, subtitles."""
from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

from config import output_dir
from db import record_usage
from voiceover import (  # noqa: F401 — re-exports for existing callers/tests
    load_cues,
    media_duration as _voice_duration,
    save_cues,
    synthesize_voice,
    synthesize_voice_full,
    synthesize_voice_safe,
    write_silent_audio,
)

logger = logging.getLogger("grokpc.video")

LogFn = Callable[[dict[str, Any]], Awaitable[None]]


async def _emit(log: Optional[LogFn], typ: str, title: str, message: str) -> None:
    if log:
        await log({"type": typ, "title": title, "message": message})


async def render_video(
    *,
    topic: str,
    script: str,
    language: str = "Hindi",
    duration_seconds: int = 15,
    log: Optional[LogFn] = None,
) -> dict[str, Any]:
    """Legacy entry used by /api/video: voiceover + FFmpeg assemble (title card if no stills)."""
    out = output_dir()
    stamp = int(time.time())
    safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in topic)[:40] or "video"
    audio = out / f"voice_{stamp}.mp3"
    final = out / f"{safe}_{stamp}.mp4"
    engine = await synthesize_voice_safe(script, language, audio, log=log)
    if not audio.is_file():
        alt = audio.with_suffix(".wav")
        if alt.is_file():
            audio = alt
    result = await assemble_video(
        title=topic,
        audio_path=audio,
        duration_seconds=max(int(duration_seconds), 8),
        log=log,
        dest=final,
        script=script,
        cues=load_cues(audio),
    )
    result["audio_path"] = str(audio)
    result["voice_engine"] = engine
    return result


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
    cues: Optional[list[dict[str, Any]]] = None,
    script: str = "",
) -> dict[str, Any]:
    """FFmpeg auto-edit (Phase 1 default editor).

    - Images: Ken Burns zoom/pan, crossfades, dark grade, BGM, burned subtitles.
    - Clips (optional Grok downloads): concat, then the same finish (BGM + subs).
    - Else a color title card, then the same finish.
    Output is 30 fps H.264 + AAC. aspect="9:16" yields 720x1280.
    """
    import shutil
    import time as _time

    from edit_fx import assemble_ken_burns, finalize_program

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
    audio = Path(audio_path) if audio_path and Path(audio_path).is_file() else None
    if cues is None and audio is not None:
        cues = load_cues(audio)
    script = script or title

    async def _run(cmd: list[str]) -> tuple[int, str]:
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        _o, err = await proc.communicate()
        return proc.returncode, err.decode("utf-8", "replace")[-1500:]

    clips = [Path(c) for c in (clips or []) if Path(c).is_file()]
    images = [Path(i) for i in (images or []) if Path(i).is_file()]

    # Stills are the default (Pollinations). Prefer them over any leftover clips.
    if images:
        try:
            result = await assemble_ken_burns(
                images,
                out,
                voice=audio,
                cues=cues or [],
                script=script,
                size=size,
                duration_seconds=duration,
                log=log,
            )
            record_usage(task_type="video", status="ok", details=str(out), provider="ffmpeg", model="kenburns")
            return result
        except Exception as exc:
            logger.warning("Ken Burns assemble failed, falling back: %s", exc)
            await _emit(log, "system", "FFmpeg stills", f"Ken Burns fail ({exc}); fallback")

    if clips:
        try:
            stitched = out.parent / f".clips_{out.stem}.mp4"
            raw = await assemble_clips(
                clips,
                audio_path=None,  # finalize_program muxes voice + BGM + subs
                dest=stitched,
                size=size,
                duration_seconds=duration,
                log=log,
            )
            picture = Path(raw["video_path"])
            await finalize_program(
                picture,
                out,
                voice=audio,
                cues=cues or [],
                script=script,
                size=size,
                log=log,
            )
            stitched.unlink(missing_ok=True)
            record_usage(task_type="video", status="ok", details=str(out), provider="ffmpeg", model="clips")
            return {"status": "success", "video_path": str(out), "engine": "ffmpeg-clips"}
        except Exception as exc:
            logger.warning("clip assembly failed, falling back: %s", exc)
            await _emit(log, "system", "FFmpeg clips", f"clip stitch fail ({exc}); fallback")

    # Title-card fallback, then still run BGM + subs if we have a voiceover.
    label = _escape_drawtext(title)
    card = out.parent / f".card_{out.stem}.mp4"
    audio_args: list[str] = []
    # Picture only here — audio is mixed in finalize.
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"color=c=0x0a101f:s={size}:d={duration}",
        "-filter_complex",
        f"drawtext=text='{label}':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=(h-text_h)/2",
        "-c:v", "libx264", "-tune", "stillimage", "-pix_fmt", "yuv420p",
        "-an", "-r", "30",
        "-movflags", "+faststart",
        str(card),
    ]
    code, err = await _run(cmd)
    if code != 0:
        cmd = [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", f"color=c=0x0a101f:s={size}:d={duration}",
            "-c:v", "libx264", "-tune", "stillimage", "-pix_fmt", "yuv420p",
            "-an", "-r", "30",
            "-movflags", "+faststart",
            str(card),
        ]
        code, err = await _run(cmd)
        if code != 0:
            raise RuntimeError(err or "ffmpeg title-card failed")
    try:
        await finalize_program(
            card,
            out,
            voice=audio,
            cues=cues or [],
            script=script,
            size=size,
            duration=float(max(duration, 8)),
            log=log,
        )
        card.unlink(missing_ok=True)
    except Exception as exc:
        logger.warning("title-card finalize failed (%s); copying raw card+voice", exc)
        if audio:
            cmd = [
                "ffmpeg", "-y", "-i", str(card), "-i", str(audio),
                "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
                "-shortest", "-movflags", "+faststart",
                str(out),
            ]
            code, err = await _run(cmd)
            if code != 0:
                raise RuntimeError(err or "title-card mux failed") from exc
        else:
            shutil.copy2(card, out)
    await _emit(log, "system", "Video ready", f"Saved to {out}")
    record_usage(task_type="video", status="ok", details=str(out), provider="ffmpeg", model="titlecard")
    return {"status": "success", "video_path": str(out), "engine": "ffmpeg-titlecard"}
