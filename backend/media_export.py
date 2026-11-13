"""Copy a finished video to the tablet gallery or Windows Videos/GrokPC.

Never raises: a failed copy is logged and the job still completes.
"""
from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import Optional

from config import ANDROID, gallery_dir, windows_final_dir

logger = logging.getLogger("grokpc.export")


def _safe_name(job_id: str, src: Path) -> str:
    if job_id:
        safe = "".join(c if c.isalnum() or c in "-_." else "_" for c in job_id)[:80]
        if safe:
            return f"GrokPC_{safe}{src.suffix or '.mp4'}"
    return src.name


def _safe_copy(src: Path, dest_dir: Path, dest_name: str) -> Optional[Path]:
    try:
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / dest_name
        if dest.exists() and dest.resolve() == src.resolve():
            return dest
        shutil.copy2(src, dest)
        logger.info("Final video copied to %s", dest)
        return dest
    except OSError as exc:
        logger.warning("Could not copy final video to %s: %s", dest_dir, exc)
        return None


def copy_final_video(src: Path | str, job_id: str = "") -> list[Path]:
    """Best-effort copies of the finished mp4. Returns destinations that succeeded."""
    copied: list[Path] = []
    path = Path(src) if src else None
    if not path or not path.is_file():
        return copied
    dest_name = _safe_name(job_id, path)

    if ANDROID:
        dest_dir = gallery_dir()
        if dest_dir is None:
            logger.info("termux-setup-storage chalao — gallery folder nahi mila, video outputs me hi hai")
        else:
            dest = _safe_copy(path, dest_dir, dest_name)
            if dest is not None:
                copied.append(dest)

    dest_dir = windows_final_dir()
    if dest_dir is not None:
        dest = _safe_copy(path, dest_dir, dest_name)
        if dest is not None:
            copied.append(dest)

    return copied
