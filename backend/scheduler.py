"""Phase 2 scaffold (FEATURE_AUTOPILOT, default OFF).

When enabled AND autopilot_enabled is on in runtime settings, pick the next
job per channel schedule while the machine is online, outside quiet hours,
under daily caps. On Windows, CapCut / desktop actions should only run when
the user has been idle (GetLastInputInfo via the helper) for IDLE_SECONDS;
if they become active mid-edit, the runner should pause the Windows step.

This module is imported safely when the flag is off. The runner in pipeline.py
only starts the loop when FEATURE_AUTOPILOT=1.
"""
from __future__ import annotations

import datetime as _dt
import logging
from typing import Any, Optional

from config import FEATURE_AUTOPILOT
from db import today_stats
from runtime_settings import load_settings

logger = logging.getLogger("grokpc.scheduler")


def _parse_quiet(window: str, now: Optional[_dt.datetime] = None) -> bool:
    """Return True if `now` is inside quiet hours (possibly wrapping midnight)."""
    now = now or _dt.datetime.now()
    window = (window or "").strip()
    if not window or "-" not in window:
        return False
    left, right = window.split("-", 1)

    def _t(s: str) -> _dt.time:
        parts = s.strip().split(":")
        h = int(parts[0] or 0)
        m = int(parts[1] if len(parts) > 1 else 0)
        return _dt.time(h % 24, m % 60)

    start, end = _t(left), _t(right)
    cur = now.time()
    if start <= end:
        return start <= cur < end
    # wraps midnight, e.g. 23:00-07:00
    return cur >= start or cur < end


def in_quiet_hours(settings: Optional[dict[str, Any]] = None, now: Optional[_dt.datetime] = None) -> bool:
    s = settings or load_settings()
    return _parse_quiet(str(s.get("quiet_hours") or ""), now=now)


def under_caps(settings: Optional[dict[str, Any]] = None) -> tuple[bool, str]:
    s = settings or load_settings()
    stats = today_stats()
    if stats["videosToday"] >= int(s.get("daily_video_cap") or 0) and int(s.get("daily_video_cap") or 0) > 0:
        return False, f"daily video cap {s['daily_video_cap']} reached"
    cap = float(s.get("daily_spend_cap_inr") or 0)
    if cap > 0 and stats["spendInrToday"] >= cap:
        return False, f"daily spend cap ₹{cap} reached"
    return True, "ok"


def weekday_key(now: Optional[_dt.datetime] = None) -> str:
    now = now or _dt.datetime.now()
    return ["mon", "tue", "wed", "thu", "fri", "sat", "sun"][now.weekday()]


def channel_is_due(channel: dict[str, Any], now: Optional[_dt.datetime] = None) -> bool:
    now = now or _dt.datetime.now()
    if not channel.get("enabled", True):
        return False
    sched = channel.get("schedule") or {}
    days = [str(d).lower()[:3] for d in (sched.get("days") or [])]
    if days and weekday_key(now) not in days:
        return False
    # Time is a "not before" hint: due at or after the scheduled time.
    raw = str(sched.get("time") or "00:00")
    try:
        h, m = [int(x) for x in raw.split(":")[:2]]
    except ValueError:
        return True
    return (now.hour, now.minute) >= (h, m)


async def windows_idle_seconds(client: Any = None) -> Optional[float]:
    try:
        from desktop_client import HelperClient

        helper = client or HelperClient()
        data = await helper.idle()
        return float(data.get("idle_seconds"))
    except Exception:
        return None


def should_run_autopilot(settings: Optional[dict[str, Any]] = None, now: Optional[_dt.datetime] = None) -> tuple[bool, str]:
    if not FEATURE_AUTOPILOT:
        return False, "FEATURE_AUTOPILOT=0 (Phase 2, default off)"
    s = settings or load_settings()
    if not s.get("autopilot_enabled"):
        return False, "autopilot toggled off"
    if in_quiet_hours(s, now=now):
        return False, "quiet hours"
    ok, reason = under_caps(s)
    if not ok:
        return False, reason
    return True, "ok"
