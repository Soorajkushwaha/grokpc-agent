"""Cinematic FFmpeg finish: Ken Burns stills, horror BGM, burned Hindi subs.

Used by video_pipeline.assemble_video. All effects are generated locally
(no copyrighted music). Fonts are best-effort — if a Devanagari font is
missing, the video still renders without burned subtitles.
"""
from __future__ import annotations

import asyncio
import logging
import re
import shutil
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

logger = logging.getLogger("grokpc.edit_fx")

LogFn = Callable[[dict[str, Any]], Awaitable[None]]

FPS = 30
DEFAULT_FADE = 0.45
GRADE_VF = (
    "eq=contrast=1.12:brightness=-0.06:saturation=0.78:gamma=0.96,"
    "vignette=angle=PI/3.6:mode=forward,"
    "noise=alls=5:allf=t+u"
)

# Bell / temple-bell words — optional synthesized SFX, not a sample library.
_BELL_RE = re.compile(
    r"(घंटी|घण्टी|घण्टा|ghanti|ghungroo|घूँघरू|घुंघरू|\bbell\b|मंदिर की घंटी)",
    re.I,
)


async def _emit(log: Optional[LogFn], title: str, message: str) -> None:
    logger.info("%s: %s", title, message)
    if log:
        await log({"type": "action", "title": title, "message": message})


async def _ffmpeg(cmd: list[str]) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    _o, err = await proc.communicate()
    return proc.returncode, (err or b"").decode("utf-8", "replace")[-2000:]


async def media_duration(path: Optional[Path]) -> float:
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
    code, _err = 0, ""
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    out, _e = await proc.communicate()
    try:
        return max(0.0, float((out or b"").decode().strip() or 0))
    except ValueError:
        return 0.0


def parse_size(size: str) -> tuple[int, int]:
    try:
        w, h = size.lower().split("x")
        return max(16, int(w)), max(16, int(h))
    except Exception:
        return 1280, 720


def find_devanagari_font() -> Optional[Path]:
    """Best-effort Noto Sans Devanagari (or similar) on Ubuntu, Debian, Termux."""
    candidates = [
        Path("/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf"),
        Path("/usr/share/fonts/truetype/noto/NotoSansDevanagari-Bold.ttf"),
        Path("/usr/share/fonts/truetype/noto/NotoSansDevanagariUI-Regular.ttf"),
        Path("/usr/share/fonts/opentype/noto/NotoSansDevanagari-Regular.otf"),
        Path("/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf"),
        Path("/usr/share/fonts/truetype/sand-box/google/Noto Sans Devanagari/NotoSansDevanagari-VariableFont_wdth,wght.ttf"),
        Path("/data/data/com.termux/files/usr/share/fonts/TTF/NotoSansDevanagari-Regular.ttf"),
        Path("/system/fonts/NotoSansDevanagari-Regular.ttf"),
        Path("/system/fonts/NotoSansDevanagari-VF.ttf"),
        Path("/system/fonts/NotoSerifDevanagari-Regular.ttf"),
    ]
    for p in candidates:
        if p.is_file():
            return p
    roots = [
        Path("/usr/share/fonts"),
        Path("/usr/local/share/fonts"),
        Path.home() / ".fonts",
        Path("/data/data/com.termux/files/usr/share/fonts"),
        Path("/system/fonts"),
    ]
    for root in roots:
        if not root.is_dir():
            continue
        try:
            for p in root.rglob("*.ttf"):
                name = p.name.lower()
                if "devanagari" in name and "noto" in name and "serif" not in name:
                    return p
            for p in root.rglob("*.ttf"):
                if "devanagari" in p.name.lower():
                    return p
        except OSError:
            continue
    return None


def ass_time(sec: float) -> str:
    sec = max(0.0, float(sec))
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = int(sec % 60)
    cs = int(round((sec - int(sec)) * 100))
    if cs >= 100:
        cs = 0
        s += 1
    if s >= 60:
        s = 0
        m += 1
    if m >= 60:
        m = 0
        h += 1
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _ass_escape(text: str) -> str:
    t = (text or "").replace("\r", "")
    t = t.replace("\\", r"\\").replace("{", r"\{").replace("}", r"\}")
    t = t.replace("\n", r"\N")
    return t.strip()


def cues_to_ass(
    cues: list[dict[str, Any]],
    dest: Path,
    *,
    width: int = 1280,
    height: int = 720,
    font_name: str = "Noto Sans Devanagari",
    font_size: int = 42,
) -> Path:
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    # Scale font a bit for vertical (9:16) frames.
    if height > width:
        font_size = int(font_size * 1.15)
        margin_v = 90
    else:
        margin_v = 56
    header = (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        "WrapStyle: 2\n"
        f"PlayResX: {width}\n"
        f"PlayResY: {height}\n"
        "ScaledBorderAndShadow: yes\n"
        "YCbCr Matrix: TV.709\n"
        "\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, "
        "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, "
        "BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Default,{font_name},{font_size},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,"
        f"0,0,0,0,100,100,0,0,1,3,0,2,70,70,{margin_v},1\n"
        "\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )
    lines = [header]
    for cue in cues:
        text = _ass_escape(str(cue.get("text") or ""))
        if not text:
            continue
        start = float(cue.get("start") or 0)
        end = float(cue.get("end") or 0)
        if end <= start:
            end = start + 1.0
        lines.append(
            f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Default,,0,0,0,,{text}\n"
        )
    dest.write_text("".join(lines), encoding="utf-8")
    return dest


def _zoom_exprs(direction: int, frames: int) -> tuple[str, str, str]:
    """Return (z, x, y) zoompan expressions. Alternate zoom/pan for variety."""
    frames = max(frames, 2)
    kind = direction % 4
    if kind == 0:  # slow zoom in, centered
        z = "min(1.0+0.00055*on,1.12)"
        x = "iw/2-(iw/zoom/2)"
        y = "ih/2-(ih/zoom/2)"
    elif kind == 1:  # slow zoom out
        z = "if(lte(on,1),1.12,max(1.12-0.00055*on,1.0))"
        x = "iw/2-(iw/zoom/2)"
        y = "ih/2-(ih/zoom/2)"
    elif kind == 2:  # pan right, slight zoom
        z = "min(1.05+0.0003*on,1.10)"
        x = f"min((iw-iw/zoom)*on/{frames},iw-iw/zoom)"
        y = "ih/2-(ih/zoom/2)"
    else:  # pan left, slight upward drift
        z = "min(1.05+0.0003*on,1.10)"
        x = f"max((iw-iw/zoom)*(1-on/{frames}),0)"
        y = f"max((ih-ih/zoom)*on/{frames}/3,0)"
    return z, x, y


async def ken_burns_clip(
    src: Path,
    dest: Path,
    duration: float,
    size: str,
    direction: int = 0,
) -> bool:
    """Animate one still into a 30 fps H.264 clip (no audio) with a slow zoom/pan."""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    w, h = parse_size(size)
    duration = max(1.0, float(duration))
    frames = max(int(round(duration * FPS)), FPS)
    z, x, y = _zoom_exprs(direction, frames)
    # Oversized even dimensions so zoompan has room.
    sw = ((w * 5) // 4) // 2 * 2
    sh = ((h * 5) // 4) // 2 * 2
    # Trim ~4% off the edges first — Pollinations sometimes leaves a tiny
    # "pollinations.ai" mark in the corner even with nologo=true.
    vf = (
        f"crop=iw*0.96:ih*0.94:iw*0.02:ih*0.02,"
        f"scale={sw}:{sh}:force_original_aspect_ratio=increase,"
        f"crop={sw}:{sh},"
        f"zoompan=z='{z}':x='{x}':y='{y}':d={frames}:s={w}x{h}:fps={FPS},"
        f"fps={FPS},format=yuv420p,setsar=1"
    )
    cmd = [
        "ffmpeg", "-y",
        "-loop", "1", "-framerate", str(FPS), "-i", str(src),
        "-vf", vf,
        "-frames:v", str(frames),
        "-t", f"{duration:.3f}",
        "-r", str(FPS),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
        "-pix_fmt", "yuv420p", "-an",
        "-movflags", "+faststart",
        str(dest),
    ]
    code, err = await _ffmpeg(cmd)
    if code != 0 or not dest.is_file() or dest.stat().st_size < 500:
        logger.info("ken burns failed for %s: %s", src.name, err[-400:])
        # Fallback: static scaled still held for `duration`.
        cmd = [
            "ffmpeg", "-y",
            "-loop", "1", "-i", str(src),
            "-t", f"{duration:.3f}",
            "-vf", (
                f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
                f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,fps={FPS},format=yuv420p,setsar=1"
            ),
            "-r", str(FPS),
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-pix_fmt", "yuv420p", "-an",
            str(dest),
        ]
        code, err = await _ffmpeg(cmd)
        if code != 0 or not dest.is_file():
            logger.warning("static still fallback failed: %s", err[-300:])
            return False
    return True


def _group_durations(
    cues: list[dict[str, Any]],
    n: int,
    total: float,
    fade: float,
) -> list[float]:
    """Duration of each Ken Burns clip so after crossfades the picture matches `total`."""
    n = max(n, 1)
    fade = max(0.0, fade)
    # After (n-1) crossfades, output length is sum(d) - (n-1)*fade.
    # We want that equal to `total`, so sum(d) = total + (n-1)*fade.
    budget = max(total, n * 1.5) + (n - 1) * fade
    weights: list[float] = []
    if cues and len(cues) >= n:
        # Group consecutive cues into n buckets.
        # Split cues evenly.
        groups = [[] for _ in range(n)]
        for i, c in enumerate(cues):
            # map by time proportion
            mid = (float(c["start"]) + float(c["end"])) / 2
            idx = min(n - 1, int((mid / max(total, 0.01)) * n))
            groups[idx].append(c)
        # If some empty, distribute by order instead.
        if any(not g for g in groups):
            groups = [[] for _ in range(n)]
            for i, c in enumerate(cues):
                groups[min(n - 1, i * n // max(len(cues), 1))].append(c)
        for g in groups:
            w = sum(max(0.05, float(c["end"]) - float(c["start"])) for c in g) if g else 1.0
            weights.append(max(w, 0.5))
    elif cues:
        # Fewer cues than images: stretch cue lengths, leftover images share last.
        raw = [max(0.4, float(c["end"]) - float(c["start"])) for c in cues]
        while len(raw) < n:
            # split the longest
            i = max(range(len(raw)), key=lambda k: raw[k])
            half = raw[i] / 2
            raw[i] = half
            raw.insert(i + 1, half)
        weights = raw[:n]
    else:
        weights = [1.0] * n
    s = sum(weights) or n
    durs = [budget * (w / s) for w in weights]
    # Guard a minimum so xfade has material (fade + 0.6s).
    floor = fade + 0.6
    durs = [max(floor, d) for d in durs]
    # Re-scale to exact budget if we lifted some floors.
    s = sum(durs)
    if s > 0:
        durs = [d * (budget / s) for d in durs]
        durs = [max(floor, d) for d in durs]
    return durs


async def crossfade_clips(
    clips: list[Path],
    dest: Path,
    fade: float = DEFAULT_FADE,
    size: str = "1280x720",
) -> Path:
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    clips = [Path(c) for c in clips if Path(c).is_file()]
    if not clips:
        raise RuntimeError("no clips to crossfade")
    if len(clips) == 1:
        shutil.copy2(clips[0], dest)
        return dest

    durs = []
    for c in clips:
        d = await media_duration(c)
        durs.append(d if d > 0 else 2.0)

    # offset_i = sum(durs[:i+1]) - fade*(i+1)  -- for joining clip i+1 onto current
    inputs: list[str] = []
    for c in clips:
        inputs += ["-i", str(c)]
    parts = []
    current = "[0:v]"
    acc = durs[0]
    for i in range(1, len(clips)):
        offset = acc - fade
        if offset < 0.1:
            offset = 0.1
        out = f"[x{i}]" if i < len(clips) - 1 else "[vout]"
        parts.append(
            f"{current}[{i}:v]xfade=transition=fade:duration={fade:.3f}:offset={offset:.3f}{out}"
        )
        current = out
        acc = acc + durs[i] - fade
    fc = ";".join(parts)
    w, h = parse_size(size)
    cmd = [
        "ffmpeg", "-y",
        *inputs,
        "-filter_complex", fc,
        "-map", "[vout]",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
        "-pix_fmt", "yuv420p", "-r", str(FPS),
        "-an", "-movflags", "+faststart",
        str(dest),
    ]
    code, err = await _ffmpeg(cmd)
    if code != 0 or not dest.is_file():
        # Fallback: plain concat, no crossfade.
        lst = dest.parent / f".xf_{dest.stem}.txt"
        lst.write_text("".join(f"file '{c.resolve()}'\n" for c in clips), encoding="utf-8")
        try:
            code, err = await _ffmpeg([
                "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst),
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", str(FPS),
                "-an", "-movflags", "+faststart",
                str(dest),
            ])
        finally:
            lst.unlink(missing_ok=True)
        if code != 0 or not dest.is_file():
            raise RuntimeError(err or "crossfade/concat failed")
    return dest


async def make_horror_bgm(
    dest: Path,
    duration: float,
    *,
    bell_times: Optional[list[float]] = None,
) -> Path:
    """Local brown-noise drone + low sine pad + optional synthesized bell.

    No third-party samples, so no copyright issues.
    """
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    d = max(2.0, float(duration))
    fade_out_start = max(0.5, d - 3.0)
    # Three beds mixed together, then a gentle limiter and fades.
    fc = (
        f"anoisesrc=color=brown:amplitude=0.4:duration={d:.3f}:sample_rate=48000,"
        f"lowpass=f=220,highpass=f=20,volume=0.45[n];"
        f"sine=frequency=54:duration={d:.3f}:sample_rate=48000,volume=0.07[p];"
        f"sine=frequency=27.5:duration={d:.3f}:sample_rate=48000,"
        f"tremolo=f=0.11:d=0.7,volume=0.09[r];"
        f"[n][p][r]amix=inputs=3:duration=longest:dropout_transition=0:normalize=0,"
        f"alimiter=limit=0.55,"
        f"afade=t=in:d=2.2,afade=t=out:st={fade_out_start:.3f}:d=2.8[bed]"
    )
    # Optional bells mixed on top (sine with long decay + echo).
    bell_inputs = ""
    mix_n = 1
    last = "[bed]"
    if bell_times:
        for i, t0 in enumerate(bell_times[:3]):
            t0 = max(0.2, float(t0))
            if t0 >= d - 0.5:
                continue
            # Generate a ~2.2s decaying "ghanti" at 784 Hz (G5) plus a lower partial.
            fc += (
                f";sine=frequency=784:duration=2.2:sample_rate=48000,"
                f"afade=t=in:d=0.02,afade=t=out:st=0.12:d=2.0,volume=0.22,"
                f"aecho=0.8:0.7:180|360:0.35|0.2,"
                f"adelay={int(t0 * 1000)}|{int(t0 * 1000)}[b{i}]"
            )
            prev = last
            last = f"[bm{i}]" if i < 2 else "[bgm]"
            fc += f";{prev}[b{i}]amix=inputs=2:duration=first:normalize=0{last}"
            mix_n += 1
    if last != "[bgm]":
        fc += f";{last}anull[bgm]" if last != "[bed]" else ";[bed]anull[bgm]"
        # simpler: just label
        if last == "[bed]":
            fc = fc.replace(";[bed]anull[bgm]", "")
            # map bed as bgm
            out_label = "[bed]"
        else:
            out_label = last
    else:
        out_label = "[bgm]"

    # Rebuild more simply to avoid label bugs when there are no bells.
    if not bell_times:
        fc = (
            f"anoisesrc=color=brown:amplitude=0.4:duration={d:.3f}:sample_rate=48000,"
            f"lowpass=f=220,highpass=f=20,volume=0.45[n];"
            f"sine=frequency=54:duration={d:.3f}:sample_rate=48000,volume=0.07[p];"
            f"sine=frequency=27.5:duration={d:.3f}:sample_rate=48000,"
            f"tremolo=f=0.11:d=0.7,volume=0.09[r];"
            f"[n][p][r]amix=inputs=3:duration=longest:dropout_transition=0:normalize=0,"
            f"alimiter=limit=0.55,"
            f"afade=t=in:d=2.2,afade=t=out:st={fade_out_start:.3f}:d=2.8[bgm]"
        )
        out_label = "[bgm]"
    else:
        # Clean rebuild with bells.
        parts = [
            f"anoisesrc=color=brown:amplitude=0.4:duration={d:.3f}:sample_rate=48000,"
            f"lowpass=f=220,highpass=f=20,volume=0.45[n]",
            f"sine=frequency=54:duration={d:.3f}:sample_rate=48000,volume=0.07[p]",
            f"sine=frequency=27.5:duration={d:.3f}:sample_rate=48000,tremolo=f=0.11:d=0.7,volume=0.09[r]",
            f"[n][p][r]amix=inputs=3:duration=longest:dropout_transition=0:normalize=0,"
            f"alimiter=limit=0.55,"
            f"afade=t=in:d=2.2,afade=t=out:st={fade_out_start:.3f}:d=2.8[bed]",
        ]
        current = "[bed]"
        used = 0
        for i, t0 in enumerate(bell_times[:3]):
            t0 = max(0.2, float(t0))
            if t0 >= d - 0.5:
                continue
            delay_ms = int(t0 * 1000)
            parts.append(
                f"sine=frequency=784:duration=2.2:sample_rate=48000,"
                f"afade=t=in:d=0.02,afade=t=out:st=0.12:d=2.0,volume=0.22,"
                f"aecho=0.8:0.7:180|360:0.35|0.2,"
                f"adelay={delay_ms}|{delay_ms}[b{i}]"
            )
            nxt = f"[bm{i}]"
            parts.append(f"{current}[b{i}]amix=inputs=2:duration=first:normalize=0{nxt}")
            current = nxt
            used += 1
        parts.append(f"{current}volume=1[bgm]")
        fc = ";".join(parts)
        out_label = "[bgm]"

    cmd = [
        "ffmpeg", "-y",
        "-filter_complex", fc,
        "-map", out_label,
        "-t", f"{d:.3f}",
        "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
        str(dest),
    ]
    # Use wav for quality / simpler mix later? AAC is fine. WAV is safer for a second mix.
    dest_wav = dest.with_suffix(".wav")
    cmd = [
        "ffmpeg", "-y",
        "-filter_complex", fc,
        "-map", out_label,
        "-t", f"{d:.3f}",
        "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2",
        str(dest_wav),
    ]
    code, err = await _ffmpeg(cmd)
    if code != 0 or not dest_wav.is_file():
        raise RuntimeError(err or "bgm generation failed")
    if dest != dest_wav:
        shutil.copy2(dest_wav, dest) if dest.suffix.lower() == ".wav" else None
        return dest_wav
    return dest_wav


def bell_times_from_cues(cues: list[dict[str, Any]], script: str = "") -> list[float]:
    times = []
    blob = script or ""
    for c in cues:
        text = str(c.get("text") or "")
        if _BELL_RE.search(text) or (not cues and _BELL_RE.search(blob)):
            mid = (float(c["start"]) + float(c["end"])) / 2
            times.append(mid)
    if not times and _BELL_RE.search(blob) and cues:
        times.append(float(cues[len(cues) // 2]["start"]))
    return times


async def finalize_program(
    picture: Path,
    dest: Path,
    *,
    voice: Optional[Path] = None,
    cues: Optional[list[dict[str, Any]]] = None,
    script: str = "",
    size: str = "1280x720",
    duration: Optional[float] = None,
    log: Optional[LogFn] = None,
    burn_subtitles: bool = True,
    bgm: bool = True,
) -> Path:
    """Color-grade the picture, mix ducked horror BGM under the voice, burn subs."""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    work = dest.parent / f".fin_{dest.stem}"
    work.mkdir(parents=True, exist_ok=True)
    try:
        w, h = parse_size(size)
        pic_dur = await media_duration(picture)
        voice_dur = await media_duration(voice) if voice and Path(voice).is_file() else 0.0
        target = duration or max(pic_dur, voice_dur, 4.0)
        if voice_dur >= 1:
            target = voice_dur

        graded = work / "graded.mp4"
        vf = (
            f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,"
            f"fps={FPS},setsar=1,format=yuv420p,"
            f"{GRADE_VF}"
        )
        # Loop picture if shorter than voice.
        loop = []
        if pic_dur and pic_dur < target - 0.25:
            loop = ["-stream_loop", "-1"]
        cmd = [
            "ffmpeg", "-y",
            *loop, "-i", str(picture),
            "-vf", vf,
            "-t", f"{target:.3f}",
            "-r", str(FPS),
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
            "-pix_fmt", "yuv420p", "-an",
            "-movflags", "+faststart",
            str(graded),
        ]
        code, err = await _ffmpeg(cmd)
        if code != 0 or not graded.is_file():
            raise RuntimeError(err or "color grade failed")

        ass_path: Optional[Path] = None
        font = find_devanagari_font()
        if burn_subtitles and cues:
            ass_path = cues_to_ass(cues, work / "subs.ass", width=w, height=h)
            # Prefer the actual font family name if we can; libass uses Fontname + fontsdir.
            if not font:
                await _emit(log, "Subtitles", "Devanagari font nahi mili — subtitles skip")
                ass_path = None

        bgm_path: Optional[Path] = None
        if bgm:
            try:
                bells = bell_times_from_cues(cues or [], script)
                bgm_path = await make_horror_bgm(work / "bgm.wav", target, bell_times=bells or None)
                await _emit(log, "BGM", f"horror bed {target:.1f}s" + (f" + {len(bells)} bell" if bells else ""))
            except Exception as exc:
                logger.warning("bgm failed: %s", exc)
                bgm_path = None

        # Mix audio: voice on top, BGM ducked (~-22 dB, sidechain if possible).
        afilters = []
        maps = ["-map", "0:v"]
        inputs = ["-i", str(graded)]
        input_idx = 1
        voice_idx = None
        bgm_idx = None
        if voice and Path(voice).is_file():
            inputs += ["-i", str(voice)]
            voice_idx = input_idx
            input_idx += 1
        if bgm_path and Path(bgm_path).is_file():
            inputs += ["-i", str(bgm_path)]
            bgm_idx = input_idx
            input_idx += 1

        fc_parts = []
        if voice_idx is not None:
            fc_parts.append(
                f"[{voice_idx}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,"
                f"volume=1.2,apad=pad_dur={target:.3f},atrim=0:{target:.3f}[vo]"
            )
        if bgm_idx is not None:
            # ~-22 dB then sidechain-duck when voice is present.
            if voice_idx is not None:
                fc_parts.append(
                    f"[{bgm_idx}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,"
                    f"volume=-22dB,apad=pad_dur={target:.3f},atrim=0:{target:.3f}[bgraw]"
                )
                fc_parts.append("[vo]asplit=2[vo_sc][vo_mix]")
                fc_parts.append(
                    f"[bgraw][vo_sc]sidechaincompress=threshold=0.04:ratio=8:attack=200:release=900:"
                    f"makeup=2:level_sc=1[bg]"
                )
                fc_parts.append(
                    f"[bg][vo_mix]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[aout]"
                )
            else:
                fc_parts.append(
                    f"[{bgm_idx}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,"
                    f"volume=-18dB,atrim=0:{target:.3f}[aout]"
                )
        elif voice_idx is not None:
            fc_parts.append("[vo]anull[aout]")

        vf_out = "copy"
        sub_vf = None
        if ass_path is not None and font is not None:
            fontsdir = str(font.parent).replace("\\", "/").replace(":", r"\:")
            ass_esc = str(ass_path).replace("\\", "/").replace(":", r"\:").replace("'", r"\'")
            sub_vf = f"subtitles='{ass_esc}':fontsdir='{fontsdir}'"

        video_need_encode = sub_vf is not None
        cmd = ["ffmpeg", "-y", *inputs]
        if fc_parts:
            cmd += ["-filter_complex", ";".join(fc_parts)]
            maps = ["-map", "0:v", "-map", "[aout]"]
        elif voice_idx is not None:
            maps = ["-map", "0:v", "-map", f"{voice_idx}:a"]
        else:
            maps = ["-map", "0:v"]

        if sub_vf:
            cmd += ["-vf", sub_vf]
            vcodec = [
                "-c:v", "libx264", "-preset", "medium", "-crf", "18",
                "-pix_fmt", "yuv420p", "-r", str(FPS),
            ]
        else:
            vcodec = ["-c:v", "copy"] if not video_need_encode else [
                "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
            ]
            # graded is already 30fps x264; copy is fine when no subs.
            vcodec = ["-c:v", "copy"]

        cmd += [
            *maps,
            *vcodec,
            "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
            "-t", f"{target:.3f}",
            "-movflags", "+faststart",
            str(dest),
        ]
        code, err = await _ffmpeg(cmd)
        if code != 0 or not dest.is_file() or dest.stat().st_size < 500:
            # Retry without subtitles, then without sidechain.
            logger.warning("finalize with subs/sidechain failed: %s", err[-400:])
            if sub_vf:
                await _emit(log, "Subtitles", "burn fail, bina subtitles retry")
                cmd = [
                    "ffmpeg", "-y", *inputs,
                ]
                if fc_parts:
                    cmd += ["-filter_complex", ";".join(fc_parts), "-map", "0:v", "-map", "[aout]"]
                elif voice_idx is not None:
                    cmd += ["-map", "0:v", "-map", f"{voice_idx}:a"]
                else:
                    cmd += ["-map", "0:v"]
                cmd += [
                    "-c:v", "copy",
                    "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
                    "-t", f"{target:.3f}",
                    "-movflags", "+faststart",
                    str(dest),
                ]
                code, err = await _ffmpeg(cmd)
            if code != 0 or not dest.is_file():
                # Last resort: picture + voice, no bgm, no subs.
                simple = [
                    "ffmpeg", "-y", "-i", str(graded),
                ]
                if voice and Path(voice).is_file():
                    simple += ["-i", str(voice), "-map", "0:v", "-map", "1:a"]
                else:
                    simple += ["-map", "0:v"]
                simple += [
                    "-c:v", "copy",
                    "-c:a", "aac", "-b:a", "160k",
                    "-t", f"{target:.3f}",
                    "-movflags", "+faststart",
                    str(dest),
                ]
                code, err = await _ffmpeg(simple)
                if code != 0 or not dest.is_file():
                    raise RuntimeError(err or "finalize mux failed")
        return dest
    finally:
        shutil.rmtree(work, ignore_errors=True)


async def assemble_ken_burns(
    images: list[Path],
    dest: Path,
    *,
    voice: Optional[Path] = None,
    cues: Optional[list[dict[str, Any]]] = None,
    script: str = "",
    size: str = "1280x720",
    duration_seconds: float = 20,
    log: Optional[LogFn] = None,
) -> dict[str, Any]:
    """Build a full program from stills: Ken Burns + crossfades + BGM + subs."""
    images = [Path(p) for p in images if Path(p).is_file()]
    if not images:
        raise RuntimeError("no images for Ken Burns")
    dest = Path(dest)
    work = dest.parent / f".kb_{dest.stem}"
    work.mkdir(parents=True, exist_ok=True)
    try:
        voice_dur = await media_duration(voice) if voice else 0.0
        total = voice_dur if voice_dur >= 1 else float(max(duration_seconds, 8))
        fade = DEFAULT_FADE if len(images) > 1 else 0.0
        durs = _group_durations(cues or [], len(images), total, fade)
        await _emit(log, "FFmpeg", f"Ken Burns {len(images)} stills, {total:.1f}s")
        clips: list[Path] = []
        for i, img in enumerate(images):
            c = work / f"kb{i:02d}.mp4"
            ok = await ken_burns_clip(img, c, durs[i], size, direction=i)
            if ok:
                clips.append(c)
        if not clips:
            raise RuntimeError("Ken Burns produced no clips")
        joined = work / "joined.mp4"
        if len(clips) == 1:
            shutil.copy2(clips[0], joined)
        else:
            await crossfade_clips(clips, joined, fade=fade, size=size)
        await finalize_program(
            joined,
            dest,
            voice=voice,
            cues=cues,
            script=script,
            size=size,
            duration=total,
            log=log,
        )
        if not dest.is_file() or dest.stat().st_size < 500:
            raise RuntimeError("Ken Burns assemble produced an empty file")
        await _emit(log, "Video ready", f"Saved to {dest}")
        return {"status": "success", "video_path": str(dest), "engine": "ffmpeg-kenburns"}
    finally:
        shutil.rmtree(work, ignore_errors=True)
