"""Phase 2 scaffold (FEATURE_YOUTUBE_UPLOAD, default OFF).

Upload via YouTube Studio in the logged-in Chrome profile. DEFAULT privacy is
Private / draft. Making a video Public requires an explicit approve-publish call.

Untested against the live YouTube Studio DOM.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

from config import DRY_RUN, FEATURE_YOUTUBE_UPLOAD

logger = logging.getLogger("grokpc.youtube")
LogFn = Callable[[dict[str, Any]], Awaitable[None]]


async def upload_private(
    video_path: Path,
    *,
    title: str,
    description: str = "",
    tags: Optional[list[str]] = None,
    channel: Optional[dict[str, Any]] = None,
    agent: Any = None,
    log: Optional[LogFn] = None,
) -> dict[str, Any]:
    if not FEATURE_YOUTUBE_UPLOAD:
        return {"status": "skipped", "privacy": "", "note": "FEATURE_YOUTUBE_UPLOAD=0"}
    if DRY_RUN:
        if log:
            await log({"type": "action", "title": "YouTube", "message": "DRY_RUN pretend private upload"})
        return {
            "status": "ok",
            "privacy": "private",
            "youtube_id": "dry-run-video",
            "note": "DRY_RUN — nothing was uploaded",
        }
    if agent is None:
        return {"status": "error", "note": "No browser agent"}
    if not Path(video_path).is_file():
        return {"status": "error", "note": f"missing file {video_path}"}

    tag_s = ", ".join(tags or [])
    ch_name = (channel or {}).get("name") or ""
    task = (
        f"Go to https://studio.youtube.com . If login is required, done with text AUTH_REQUIRED. "
        f"Upload the local file '{video_path}' as a NEW video for channel '{ch_name}'. "
        f"Set the title to: {title}. Description: {description[:500]}. Tags: {tag_s}. "
        "CRITICAL: set visibility to PRIVATE (or save as Draft). Do NOT set Public or Unlisted. "
        "Finish the upload. When done, action done and put the YouTube video id (or URL) in text."
    )
    result = await agent.run_generic_task(task)
    text = str(result.get("result") or "")
    if "AUTH_REQUIRED" in text.upper():
        return {"status": "waiting_login", "privacy": "", "note": text}
    return {
        "status": "ok" if result.get("status") == "success" else result.get("status") or "ok",
        "privacy": "private",
        "youtube_id": text[:200],
        "raw": result.get("status"),
    }


async def approve_publish(
    youtube_id: str,
    *,
    agent: Any = None,
    log: Optional[LogFn] = None,
) -> dict[str, Any]:
    """Explicit second step: change a private/draft video to Public."""
    if not FEATURE_YOUTUBE_UPLOAD:
        return {"status": "skipped", "note": "FEATURE_YOUTUBE_UPLOAD=0"}
    if DRY_RUN:
        return {"status": "ok", "privacy": "public", "youtube_id": youtube_id, "note": "DRY_RUN"}
    if agent is None:
        return {"status": "error", "note": "No browser agent"}
    task = (
        f"Go to YouTube Studio, open the uploaded video '{youtube_id}', "
        "change visibility from Private/Draft to PUBLIC, and save. "
        "If a confirmation dialog appears, confirm. "
        "When it is Public, action done with text PUBLISHED and the video URL."
    )
    result = await agent.run_generic_task(task)
    return {
        "status": "ok" if result.get("status") == "success" else result.get("status") or "ok",
        "privacy": "public",
        "youtube_id": youtube_id,
        "raw": str(result.get("result") or "")[:300],
    }
