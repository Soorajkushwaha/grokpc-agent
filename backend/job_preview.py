"""Latest visual artifact for a job — a still image or a video frame.

The frontend shows this as "Live preview" on each device card. This is not a
screen mirror: Termux cannot capture the Android display without root, so we
surface the newest scene still, or an ffmpeg frame from a partial or final mp4.
The same endpoint works on the laptop and a VPS.
"""
from __future__ import annotations

import base64
import logging
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Optional

from config import output_dir
from jobs import get_job

logger = logging.getLogger("grokpc.preview")

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".ppm", ".bmp"}
VIDEO_EXT = {".mp4", ".webm", ".mkv", ".mov"}


def _is_file(path: Path) -> bool:
    try:
        return path.is_file() and path.stat().st_size > 32
    except OSError:
        return False


def _mtime(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except OSError:
        return 0.0


def _unique(paths: list[Path]) -> list[Path]:
    seen: set[Path] = set()
    out: list[Path] = []
    for raw in paths:
        try:
            key = raw.resolve()
        except OSError:
            key = raw
        if key in seen or not _is_file(raw):
            continue
        seen.add(key)
        out.append(raw)
    return out


def _collect_images(job: dict[str, Any]) -> list[Path]:
    found: list[Path] = []
    for raw in job.get("media") or []:
        path = Path(str(raw))
        if path.suffix.lower() in IMAGE_EXT:
            found.append(path)
    job_dir = output_dir() / str(job["id"])
    if job_dir.is_dir():
        for path in job_dir.rglob("*"):
            if path.is_file() and path.suffix.lower() in IMAGE_EXT:
                found.append(path)
    return sorted(_unique(found), key=_mtime, reverse=True)


def _collect_videos(job: dict[str, Any]) -> list[Path]:
    found: list[Path] = []
    for key in ("final_path", "video_path"):
        raw = (job.get(key) or "").strip()
        if raw:
            found.append(Path(raw))
    out = output_dir()
    job_id = str(job["id"])
    for path in (out / f"final_{job_id}.mp4", out / f"{job_id}.mp4"):
        found.append(path)
    job_dir = out / job_id
    if job_dir.is_dir():
        for path in job_dir.rglob("*"):
            if path.is_file() and path.suffix.lower() in VIDEO_EXT:
                found.append(path)
    return sorted(_unique(found), key=_mtime, reverse=True)


def _run_ffmpeg(cmd: list[str], dest: Path) -> bool:
    try:
        dest.unlink(missing_ok=True)
        result = subprocess.run(cmd, capture_output=True, timeout=12)
    except (OSError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0 and _is_file(dest)


def _thumb_bytes(src: Path, is_video: bool) -> Optional[bytes]:
    """Resize to a small JPEG. Fall back to raw bytes for an existing JPEG."""
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        with tempfile.TemporaryDirectory(prefix="grokpc-prev-") as tmp:
            dest = Path(tmp) / "frame.jpg"
            vf = "scale=480:-2"
            if is_video:
                attempts = (
                    [ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
                     "-sseof", "-1", "-i", str(src), "-vf", vf, "-frames:v", "1",
                     "-q:v", "5", str(dest)],
                    [ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
                     "-ss", "0.3", "-i", str(src), "-vf", vf, "-frames:v", "1",
                     "-q:v", "5", str(dest)],
                )
            else:
                attempts = (
                    [ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
                     "-i", str(src), "-vf", vf, "-frames:v", "1", "-q:v", "5",
                     str(dest)],
                )
            for cmd in attempts:
                if _run_ffmpeg(cmd, dest):
                    return dest.read_bytes()
    if not is_video:
        try:
            data = src.read_bytes()
        except OSError:
            return None
        # JPEG magic, or a small enough PNG we can still send
        if data[:2] == b"\xff\xd8" or (src.suffix.lower() in IMAGE_EXT and len(data) < 2_000_000):
            return data
    return None


def _latest_log(job: dict[str, Any]) -> str:
    logs = job.get("recent_logs") or []
    if not logs:
        return ""
    first = logs[0] or {}
    return str(first.get("message") or "")[:500]


def build_preview(job_id: str) -> Optional[dict[str, Any]]:
    job = get_job(job_id, with_logs=True, log_limit=8)
    if not job:
        return None

    images = _collect_images(job)
    videos = _collect_videos(job)
    candidates: list[tuple[str, Path]] = []
    for path in images:
        candidates.append(("still", path))
    for path in videos:
        candidates.append(("video_frame", path))
    candidates.sort(key=lambda item: _mtime(item[1]), reverse=True)

    source: Optional[str] = None
    image: Optional[bytes] = None
    mime = "image/jpeg"
    for kind, path in candidates:
        data = _thumb_bytes(path, is_video=(kind == "video_frame"))
        if data:
            source = kind
            image = data
            if data[:2] == b"\xff\xd8":
                mime = "image/jpeg"
            elif data[:8] == b"\x89PNG\r\n\x1a\n":
                mime = "image/png"
            elif data[:4] == b"RIFF":
                mime = "image/webp"
            else:
                mime = "image/jpeg"
            break

    return {
        "ok": True,
        "job_id": job["id"],
        "status": job["status"],
        "current_step": job.get("current_step") or "",
        "topic": job.get("topic") or "",
        "log_line": _latest_log(job),
        "source": source,
        "mime": mime if image else None,
        "image_b64": base64.b64encode(image).decode("ascii") if image else None,
        "has_video": bool(videos),
        "updated_at": job.get("updated_at") or "",
        "note": "Latest scene still or video frame — not a live device screen.",
    }
