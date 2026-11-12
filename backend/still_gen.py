"""Free still-image visuals via Pollinations (Flux), no API key.

Used as the default visuals source. Browser clip sites (Grok Imagine,
Google Vids) are opt-in and only accepted when they actually download a
generated file — never a screen recording or a marketing-page <video>.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import re
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional
from urllib.parse import quote

logger = logging.getLogger("grokpc.stills")

LogFn = Callable[[dict[str, Any]], Awaitable[None]]

STYLE_SUFFIX = (
    "cinematic dark horror, Indian haunted haveli, moody low light, "
    "film grain, photorealistic, no text"
)
SAFETY_SUFFIX = (
    "no people, no human faces, no children, no blood, no gore, no weapons, "
    "no watermark, no logo, no letters, no caption"
)
DEFAULT_MODEL = "flux"
FALLBACK_MODEL = "turbo"
MAX_SCENES = 10
MIN_IMAGE_BYTES = 12_000


async def _emit(log: Optional[LogFn], title: str, message: str) -> None:
    logger.info("%s: %s", title, message)
    if log:
        await log({"type": "action", "title": title, "message": message})


def pollinations_url(
    prompt: str,
    *,
    width: int = 1280,
    height: int = 720,
    seed: int = 1,
    model: str = DEFAULT_MODEL,
) -> str:
    q = quote(prompt, safe="")
    return (
        f"https://image.pollinations.ai/prompt/{q}"
        f"?width={int(width)}&height={int(height)}&nologo=true"
        f"&seed={int(seed)}&model={quote(model, safe='')}"
    )


def decorate_prompt(prompt: str) -> str:
    p = re.sub(r"\s+", " ", (prompt or "").strip())
    # Don't double-append the style if the planner already included it.
    if "cinematic dark horror" not in p.lower():
        p = f"{p}, {STYLE_SUFFIX}"
    if "no people" not in p.lower():
        p = f"{p}, {SAFETY_SUFFIX}"
    return p[:1800]


def image_specs(plan: dict[str, Any], limit: Optional[int] = None) -> list[dict[str, Any]]:
    """Per-scene English image prompts from a planner plan."""
    cap = MAX_SCENES if limit is None else limit
    scenes = plan.get("scenes") if isinstance(plan.get("scenes"), list) else []
    out: list[dict[str, Any]] = []
    for i, raw in enumerate(scenes):
        s = raw if isinstance(raw, dict) else {"narration": str(raw)}
        prompt = (
            str(s.get("image_prompt") or "").strip()
            or str(s.get("visual") or "").strip()
            or str(s.get("video_prompt") or "").strip()
            or str(s.get("narration") or "").strip()
        )
        if not prompt:
            continue
        try:
            dur = float(s.get("duration_sec") or s.get("duration") or 8)
        except (TypeError, ValueError):
            dur = 8.0
        out.append({
            "index": int(s.get("id") or (i + 1)),
            "prompt": decorate_prompt(prompt),
            "raw_prompt": prompt,
            "duration_sec": max(2.0, dur),
            "narration": str(s.get("narration") or "").strip(),
        })
        if len(out) >= cap:
            break
    if not out:
        title = str(plan.get("title") or plan.get("hook") or "cinematic haunted haveli at night")
        story = str(plan.get("story") or plan.get("voiceover_script") or title)
        # Invent a small consistent set so we still produce a video.
        beats = [
            f"Abandoned Indian haveli courtyard at midnight, moonlight, {title}",
            f"A single oil lamp (diya) flickering on a stone ledge in a haunted haveli, {story[:120]}",
            "Thick fog rolling through a broken Indian haveli courtyard at night",
            "Dark silhouette emerging from fog at the carved gate of an old haveli, moon behind",
            "Close on a trembling oil-lamp flame in the dark, fog around carved pillars",
            "Dawn over an empty Indian haveli courtyard, leftover mist, a diya still burning",
        ]
        for i, b in enumerate(beats, 1):
            out.append({
                "index": i,
                "prompt": decorate_prompt(b),
                "raw_prompt": b,
                "duration_sec": 8.0,
                "narration": "",
            })
    return out[:cap]


def _seed_for(job_id: str, index: int) -> int:
    raw = f"{job_id}:{index}".encode("utf-8")
    return int(hashlib.sha256(raw).hexdigest()[:8], 16) % 1_000_000_000


def _looks_like_image(data: bytes) -> bool:
    if not data or len(data) < MIN_IMAGE_BYTES:
        return False
    if data[:3] == b"\xff\xd8\xff":  # JPEG
        return True
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return True
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return True
    # Some gateways wrap a JSON error.
    head = data[:32].lstrip()
    if head.startswith(b"{") or head.startswith(b"<"):
        return False
    return False


def _suffix_for(data: bytes) -> str:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    if data[:4] == b"RIFF":
        return ".webp"
    return ".jpg"


async def fetch_pollinations(
    prompt: str,
    dest: Path,
    *,
    width: int = 1280,
    height: int = 720,
    seed: int = 1,
    timeout: float = 120.0,
    retries: int = 3,
) -> Path:
    import httpx

    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; GrokPC/1.0)",
        "Accept": "image/jpeg,image/png,image/webp,image/*;q=0.9,*/*;q=0.8",
    }
    last_err: Optional[Exception] = None
    models = [DEFAULT_MODEL, FALLBACK_MODEL]
    for model in models:
        url = pollinations_url(prompt, width=width, height=height, seed=seed, model=model)
        for attempt in range(max(1, retries)):
            try:
                async with httpx.AsyncClient(
                    timeout=httpx.Timeout(timeout, connect=20.0),
                    follow_redirects=True,
                    headers=headers,
                ) as client:
                    resp = await client.get(url)
                if resp.status_code in {429, 500, 502, 503, 504}:
                    last_err = RuntimeError(f"HTTP {resp.status_code}")
                    await asyncio.sleep(1.5 * (attempt + 1))
                    continue
                resp.raise_for_status()
                data = resp.content or b""
                if not _looks_like_image(data):
                    last_err = RuntimeError(f"not an image ({len(data)} bytes, status {resp.status_code})")
                    await asyncio.sleep(1.2 * (attempt + 1))
                    continue
                path = dest.with_suffix(_suffix_for(data))
                path.write_bytes(data)
                return path
            except Exception as exc:
                last_err = exc
                logger.info("pollinations %s attempt %s: %s", model, attempt + 1, exc)
                await asyncio.sleep(1.2 * (attempt + 1))
    raise RuntimeError(f"Pollinations failed: {last_err}")


async def generate_pollinations_images(
    plan: dict[str, Any],
    dest_dir: Path,
    *,
    job_id: str = "",
    log: Optional[LogFn] = None,
    width: int = 1280,
    height: int = 720,
    limit: Optional[int] = None,
) -> dict[str, Any]:
    dest_dir = Path(dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)
    specs = image_specs(plan, limit=limit)
    paths: list[Path] = []
    notes: list[str] = []
    await _emit(log, "Visuals", f"Pollinations se {len(specs)} scene stills")
    for spec in specs:
        idx = int(spec["index"])
        seed = _seed_for(job_id or "job", idx)
        dest = dest_dir / f"scene_{idx:02d}.jpg"
        try:
            path = await fetch_pollinations(
                spec["prompt"], dest, width=width, height=height, seed=seed
            )
            paths.append(path)
            await _emit(log, "Visuals", f"still {idx}: {path.name} ({path.stat().st_size} B)")
        except Exception as exc:
            notes.append(f"scene {idx}: {exc}")
            logger.warning("pollinations scene %s failed: %s", idx, exc)
            await _emit(log, "Visuals", f"still {idx} fail: {exc}")
        # Be polite to the free endpoint.
        await asyncio.sleep(0.4)
    if not paths:
        return {
            "status": "skipped",
            "paths": [],
            "provider": "pollinations",
            "note": "; ".join(notes) or "Pollinations returned no images",
        }
    note = f"{len(paths)}/{len(specs)} stills"
    if notes:
        note += " — " + "; ".join(notes)
    return {
        "status": "ok",
        "paths": paths,
        "provider": "pollinations",
        "note": note,
    }


async def fake_images(
    plan: dict[str, Any],
    dest_dir: Path,
    log: Optional[LogFn] = None,
) -> dict[str, Any]:
    """DRY_RUN: solid-color 1280x720 JPEGs so Ken Burns can be tested offline."""
    import shutil

    dest_dir = Path(dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)
    specs = image_specs(plan)
    colors = ["0x1a1020", "0x102018", "0x201810", "0x101828", "0x181010", "0x101810", "0x14101c", "0x1c1410"]
    paths: list[Path] = []
    if not shutil.which("ffmpeg"):
        # Tiny valid JPEG (1x1) is too small for Ken Burns checks; write a minimal PPM and give up.
        for i, _s in enumerate(specs):
            p = dest_dir / f"dry_{i+1:02d}.ppm"
            p.write_bytes(b"P6\n1280 720\n255\n" + bytes([20, 16, 28]) * (1280 * 720))
            paths.append(p)
        return {"status": "ok", "paths": paths, "provider": "dry_run", "note": "DRY_RUN fake stills (no ffmpeg)"}

    for i, _s in enumerate(specs):
        path = dest_dir / f"dry_{i+1:02d}.jpg"
        color = colors[i % len(colors)]
        cmd = [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", f"color=c={color}:s=1280x720:d=1",
            "-frames:v", "1",
            "-q:v", "4",
            str(path),
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        _o, err = await proc.communicate()
        if proc.returncode != 0 or not path.is_file():
            raise RuntimeError((err or b"").decode("utf-8", "replace")[-400:] or "ffmpeg fake still failed")
        paths.append(path)
    await _emit(log, "Visuals", f"DRY_RUN {len(paths)} fake stills")
    return {
        "status": "ok",
        "paths": paths,
        "provider": "dry_run",
        "note": f"DRY_RUN fake stills ({len(paths)})",
    }


# --- Guard: only accept real downloads, never a captured UI / marketing video. ---

_VIDEO_SUFFIXES = {".mp4", ".webm", ".mov", ".mkv", ".m4v"}
MIN_CLIP_BYTES = 50_000


def is_accepted_download(path: Path, *, from_download_event: bool) -> bool:
    """Reject clips that were harvested off a page (marketing videos, UI recordings).

    Only Playwright `download` events — a file the generator actually saved —
    are accepted. Harvesting a <video> already on the landing page is how the
    previous Google Vids step captured smiling stock people and the Vids logo.
    """
    path = Path(path)
    if not from_download_event:
        return False
    if not path.is_file():
        return False
    if path.suffix.lower() not in _VIDEO_SUFFIXES:
        return False
    try:
        if path.stat().st_size < MIN_CLIP_BYTES:
            return False
    except OSError:
        return False
    return True
