"""User-tunable caps and quiet hours, stored next to the DB (not in git)."""
from __future__ import annotations

import json
from typing import Any

from config import (
    AUTOPILOT_ENABLED,
    DAILY_SPEND_CAP_INR,
    DAILY_VIDEO_CAP,
    IDLE_SECONDS,
    QUIET_HOURS,
    runtime_settings_path,
)

KEYS = ("quiet_hours", "idle_seconds", "daily_video_cap", "daily_spend_cap_inr", "autopilot_enabled")


def defaults() -> dict[str, Any]:
    return {
        "quiet_hours": QUIET_HOURS,
        "idle_seconds": IDLE_SECONDS,
        "daily_video_cap": DAILY_VIDEO_CAP,
        "daily_spend_cap_inr": DAILY_SPEND_CAP_INR,
        "autopilot_enabled": AUTOPILOT_ENABLED,
    }


def load_settings() -> dict[str, Any]:
    data = defaults()
    path = runtime_settings_path()
    if path.is_file():
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                data.update({k: raw[k] for k in KEYS if k in raw})
        except (OSError, json.JSONDecodeError):
            pass
    return data


def save_settings(payload: dict[str, Any]) -> dict[str, Any]:
    data = load_settings()
    if "quiet_hours" in payload and payload["quiet_hours"] is not None:
        data["quiet_hours"] = str(payload["quiet_hours"]).strip() or data["quiet_hours"]
    if "idle_seconds" in payload and payload["idle_seconds"] is not None:
        data["idle_seconds"] = max(30, int(payload["idle_seconds"]))
    if "daily_video_cap" in payload and payload["daily_video_cap"] is not None:
        data["daily_video_cap"] = max(0, int(payload["daily_video_cap"]))
    if "daily_spend_cap_inr" in payload and payload["daily_spend_cap_inr"] is not None:
        data["daily_spend_cap_inr"] = max(0.0, float(payload["daily_spend_cap_inr"]))
    if "autopilot_enabled" in payload and payload["autopilot_enabled"] is not None:
        data["autopilot_enabled"] = bool(payload["autopilot_enabled"])
    path = runtime_settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return data
