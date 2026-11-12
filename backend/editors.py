"""Pluggable editors: CapCut (Windows helper) primary when available, FFmpeg
fallback (Phase 1 default that always works), optional Shotcut/Kdenlive hooks.

CapCut has no Linux build and no public API. We can:
  1. Copy media to a Windows-visible folder (Videos/GrokPC/import).
  2. Launch CapCut via the desktop helper (if the user installed it).
  3. Optionally drive the UI with the Windows vision loop (fragile; UI changes break it).

We do NOT claim a finished, reliable timeline edit. If the helper is down, CapCut
is missing, or anything fails, we always fall back to FFmpeg so the job completes.
"""
from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

from config import DRY_RUN, FEATURE_CAPCUT, windows_media_dir
from video_pipeline import assemble_video

logger = logging.getLogger("grokpc.editors")
LogFn = Callable[[dict[str, Any]], Awaitable[None]]


def wsl_to_windows(path: Path | str) -> str:
    """Translate /mnt/c/Users/x -> C:\\Users\\x. Other paths are returned as-is."""
    p = str(path)
    if p.startswith("/mnt/") and len(p) > 6 and p[5].isalpha() and p[6] == "/":
        drive = p[5].upper()
        rest = p[7:].replace("/", "\\")
        return f"{drive}:\\{rest}"
    return p


async def _emit(log: Optional[LogFn], title: str, message: str) -> None:
    logger.info("%s: %s", title, message)
    if log:
        await log({"type": "action", "title": title, "message": message})


def stage_media_for_windows(paths: list[Path]) -> list[Path]:
    dest_root = windows_media_dir() / "import"
    dest_root.mkdir(parents=True, exist_ok=True)
    staged: list[Path] = []
    for src in paths:
        if not src or not Path(src).is_file():
            continue
        src = Path(src)
        dest = dest_root / src.name
        try:
            if src.resolve() != dest.resolve():
                shutil.copy2(src, dest)
            staged.append(dest)
        except OSError as exc:
            logger.warning("Could not stage %s: %s", src, exc)
            staged.append(src)
    return staged


async def ffmpeg_edit(
    *,
    title: str,
    audio_path: Optional[Path],
    images: Optional[list[Path]] = None,
    clips: Optional[list[Path]] = None,
    duration_seconds: int = 20,
    aspect: str = "16:9",
    log: Optional[LogFn] = None,
    dest: Optional[Path] = None,
) -> dict[str, Any]:
    result = await assemble_video(
        title=title,
        audio_path=audio_path,
        images=images,
        clips=clips,
        duration_seconds=duration_seconds,
        aspect=aspect,
        log=log,
        dest=dest,
    )
    result["editor"] = "ffmpeg"
    return result


async def capcut_prepare(
    media: list[Path],
    *,
    log: Optional[LogFn] = None,
    client: Any = None,
) -> dict[str, Any]:
    """Launch CapCut and stage media. Vision-driven timeline edit is best-effort.

    Limits (honest):
    - No official CapCut automation API.
    - File-dialog / timeline clicks via screenshots will break when the UI changes.
    - Auto-cut / templates may work better than precise edits.
    - The finished file must still be found on disk (CapCut export folder) — we
      do not wait forever; FFmpeg fallback is used if no export appears.
    - This only runs on the Windows laptop with the desktop helper in the user session.
    - CapCut-on-Android (tablet) is not supported.
    """
    if not FEATURE_CAPCUT:
        return {"status": "skipped", "reason": "FEATURE_CAPCUT=0"}
    if DRY_RUN:
        await _emit(log, "CapCut", "DRY_RUN: skip real CapCut, FFmpeg will edit")
        return {"status": "skipped", "reason": "dry_run"}

    from desktop_client import HelperClient, HelperError

    helper = client or HelperClient()
    try:
        health = await helper.health()
    except HelperError as exc:
        await _emit(log, "CapCut", f"Helper nahi mila ({exc}); FFmpeg fallback")
        return {"status": "skipped", "reason": f"helper: {exc}"}

    staged = stage_media_for_windows(media)
    win_paths = [wsl_to_windows(p) for p in staged]
    try:
        imported = await helper.import_media(win_paths, open_folder=True)
    except HelperError as exc:
        await _emit(log, "CapCut", f"Import staging fail: {exc}")
        imported = {"error": str(exc), "paths": win_paths}

    try:
        launched = await helper.launch("capcut")
    except HelperError as exc:
        await _emit(log, "CapCut", f"CapCut launch fail: {exc}; FFmpeg fallback")
        return {
            "status": "skipped",
            "reason": f"launch: {exc}",
            "staged": [str(p) for p in staged],
            "import": imported,
            "helper_health": health,
        }

    await _emit(
        log,
        "CapCut",
        "CapCut khul gaya. Media Videos\\GrokPC\\import me hai. "
        "Poora timeline edit automatic reliably nahi ho sakta — FFmpeg se final cut bhi banega.",
    )
    return {
        "status": "prepared",
        "editor": "capcut",
        "launched": launched,
        "import": imported,
        "staged": [str(p) for p in staged],
        "windows_paths": win_paths,
        "helper_health": health,
        "limits": (
            "CapCut UI automation is best-effort only. A finished FFmpeg cut is "
            "always produced as the reliable final file. Review in CapCut if you want."
        ),
    }


async def hook_launch(app: str, log: Optional[LogFn] = None) -> dict[str, Any]:
    """Optional Shotcut / Kdenlive hook — just launch if the helper sees them."""
    from desktop_client import HelperClient, HelperError

    try:
        helper = HelperClient()
        result = await helper.launch(app)
        await _emit(log, "Editor hook", f"Launched {app}")
        return {"status": "launched", "app": app, "result": result}
    except Exception as exc:
        return {"status": "skipped", "app": app, "reason": str(exc)[:200]}


async def edit_video(
    *,
    title: str,
    audio_path: Optional[Path],
    images: Optional[list[Path]] = None,
    clips: Optional[list[Path]] = None,
    duration_seconds: int = 20,
    aspect: str = "16:9",
    log: Optional[LogFn] = None,
    dest: Optional[Path] = None,
    prefer_capcut: bool = True,
) -> dict[str, Any]:
    capcut_info: Optional[dict[str, Any]] = None
    media = [p for p in [audio_path, *(images or []), *(clips or [])] if p]
    if prefer_capcut and FEATURE_CAPCUT and not DRY_RUN:
        capcut_info = await capcut_prepare([Path(p) for p in media if p], log=log)

    result = await ffmpeg_edit(
        title=title,
        audio_path=audio_path,
        images=images,
        clips=clips,
        duration_seconds=duration_seconds,
        aspect=aspect,
        log=log,
        dest=dest,
    )
    if capcut_info:
        result["capcut"] = capcut_info
        if capcut_info.get("status") == "prepared":
            result["editor"] = "ffmpeg+capcut-prepared"
    return result
