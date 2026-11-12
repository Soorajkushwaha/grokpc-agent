"""Phase 2 scaffold (FEATURE_VEO / FEATURE_GROK_IMAGINE, default OFF).

Browser automation for Google Veo (Gemini app / Flow) and Grok Imagine.
Untested against live sites. In DRY_RUN or when flags are off, the pipeline
skips this step. When flags are on, credit check runs first (if enabled).
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

from config import DRY_RUN, FEATURE_GROK_IMAGINE, FEATURE_VEO, GEMINI_API_KEY

logger = logging.getLogger("grokpc.generators")
LogFn = Callable[[dict[str, Any]], Awaitable[None]]


async def generate_media(
    plan: dict[str, Any],
    *,
    job_id: str,
    dest_dir: Path,
    agent: Any = None,
    log: Optional[LogFn] = None,
    provider: Optional[str] = None,
) -> dict[str, Any]:
    if DRY_RUN or not (FEATURE_VEO or FEATURE_GROK_IMAGINE):
        return {
            "status": "skipped",
            "paths": [],
            "provider": provider or "",
            "note": "Phase 2 video generation is flag-gated and off by default",
        }

    from credits import choose_provider

    # Credit check is itself flag-gated; if off, we still refuse to spend
    # blindly unless a provider was forced.
    if not provider:
        decision = await choose_provider(job_id, agent=agent)
        provider = decision.get("decided") if decision.get("has_balance") else None
        if not provider or provider in {"none", "skipped", "dry_run_skip"}:
            return {
                "status": "waiting_credits",
                "paths": [],
                "credit": decision,
                "note": "No provider with enough credits; job should pause.",
            }

    if log:
        await log({"type": "action", "title": "Generate", "message": f"Using {provider}"})

    # Placeholder: a real implementation would drive the site (or Veo API if
    # GEMINI_API_KEY + a Veo model is available) and download files into dest_dir.
    dest_dir.mkdir(parents=True, exist_ok=True)
    return {
        "status": "error",
        "paths": [],
        "provider": provider,
        "note": (
            f"Live {provider} generation is scaffolded but not implemented against "
            "the current site/API. Set FEATURE_VEO=0 / FEATURE_GROK_IMAGINE=0 and "
            "use the FFmpeg path."
        ),
        "gemini_key_present": bool(GEMINI_API_KEY),
    }
