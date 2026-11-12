"""YouTube channel config (JSON file). Three placeholders, easy to add more."""
from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any, Optional

from config import channels_path

DEFAULT_CHANNELS = [
    {
        "id": "ch1",
        "name": "Channel 1",
        "niche": "",
        "language": "Hindi",
        "style": "Practical, hook pehle, clear Hinglish",
        "youtube_url": "",
        "schedule": {"days": ["mon", "wed", "fri"], "time": "18:00"},
        "aspect": "16:9",
        "enabled": True,
    },
    {
        "id": "ch2",
        "name": "Channel 2",
        "niche": "",
        "language": "Hindi",
        "style": "Story-led, emotional, simple words",
        "youtube_url": "",
        "schedule": {"days": ["tue", "thu", "sat"], "time": "18:00"},
        "aspect": "16:9",
        "enabled": True,
    },
    {
        "id": "ch3",
        "name": "Channel 3",
        "niche": "",
        "language": "Hindi",
        "style": "Short, punchy, mobile-first",
        "youtube_url": "",
        "schedule": {"days": ["sun", "wed"], "time": "19:00"},
        "aspect": "9:16",
        "enabled": True,
    },
]


def _validate(ch: dict[str, Any], *, existing_id: Optional[str] = None) -> dict[str, Any]:
    name = str(ch.get("name") or "").strip()
    if not name:
        raise ValueError("Channel name is required")
    cid = str(ch.get("id") or existing_id or f"ch-{uuid.uuid4().hex[:8]}")
    days = ch.get("schedule", {}).get("days") if isinstance(ch.get("schedule"), dict) else None
    if not days:
        days = ["mon", "wed", "fri"]
    time_s = "18:00"
    if isinstance(ch.get("schedule"), dict):
        time_s = str(ch["schedule"].get("time") or "18:00")
    aspect = ch.get("aspect") or "16:9"
    if aspect not in {"16:9", "9:16", "1:1"}:
        aspect = "16:9"
    return {
        "id": cid,
        "name": name[:80],
        "niche": str(ch.get("niche") or "")[:200],
        "language": str(ch.get("language") or "Hindi")[:40],
        "style": str(ch.get("style") or "")[:400],
        "youtube_url": str(ch.get("youtube_url") or "")[:300],
        "schedule": {"days": [str(d).lower()[:3] for d in days], "time": time_s},
        "aspect": aspect,
        "enabled": bool(ch.get("enabled", True)),
    }


def _read(path: Optional[Path] = None) -> list[dict[str, Any]]:
    path = path or channels_path()
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if isinstance(data, dict) and "channels" in data:
        data = data["channels"]
    if not isinstance(data, list):
        return []
    out = []
    for raw in data:
        if isinstance(raw, dict) and raw.get("name"):
            try:
                out.append(_validate(raw, existing_id=raw.get("id")))
            except ValueError:
                continue
    return out


def _write(channels: list[dict[str, Any]], path: Optional[Path] = None) -> None:
    path = path or channels_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(channels, indent=2, ensure_ascii=False), encoding="utf-8")


def ensure_defaults() -> list[dict[str, Any]]:
    path = channels_path()
    existing = _read(path)
    if existing:
        return existing
    channels = [dict(c) for c in DEFAULT_CHANNELS]
    _write(channels, path)
    return channels


def list_channels() -> list[dict[str, Any]]:
    return ensure_defaults()


def get_channel(channel_id: str) -> Optional[dict[str, Any]]:
    for ch in list_channels():
        if ch["id"] == channel_id:
            return ch
    return None


def add_channel(payload: dict[str, Any]) -> dict[str, Any]:
    channels = list_channels()
    ch = _validate(payload)
    if any(c["id"] == ch["id"] for c in channels):
        ch["id"] = f"ch-{uuid.uuid4().hex[:8]}"
    channels.append(ch)
    _write(channels)
    return ch


def update_channel(channel_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    channels = list_channels()
    for i, c in enumerate(channels):
        if c["id"] == channel_id:
            merged = {**c, **payload, "id": channel_id}
            channels[i] = _validate(merged, existing_id=channel_id)
            _write(channels)
            return channels[i]
    raise KeyError(channel_id)


def delete_channel(channel_id: str) -> None:
    channels = list_channels()
    if len(channels) <= 1:
        raise ValueError("At least one channel is required")
    kept = [c for c in channels if c["id"] != channel_id]
    if len(kept) == len(channels):
        raise KeyError(channel_id)
    _write(kept)
