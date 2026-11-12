"""Phase 2 scaffold (FEATURE_CREDIT_CHECK, default OFF).

When enabled, check remaining credits on Veo / Grok Imagine before generating,
pick a provider with enough balance, or pause the job. Decisions are written
to the credit_checks table. Untested against live billing pages.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from config import DRY_RUN, FEATURE_CREDIT_CHECK, FEATURE_GROK_IMAGINE, FEATURE_VEO, GEMINI_API_KEY
from jobs import record_credit_check

logger = logging.getLogger("grokpc.credits")


async def check_gemini_api() -> dict[str, Any]:
    """Best-effort: if a Gemini key exists, we only know the key is present.

    Google does not expose a simple 'Veo credits left' API we can rely on.
    Report 'unknown' rather than invent a number.
    """
    if not GEMINI_API_KEY:
        return {"provider": "veo", "has_balance": False, "remaining": None, "source": "no_api_key"}
    return {
        "provider": "veo",
        "has_balance": True,  # key present; actual quota is unknown
        "remaining": None,
        "source": "api_key_present",
        "note": "Quota is not readable via a stable API; treat as maybe-available.",
    }


async def check_via_browser(provider: str, agent: Any = None) -> dict[str, Any]:
    """Phase 2: open the provider's billing/usage page and read it with vision.

    Not called unless FEATURE_CREDIT_CHECK=1. Returns a structured unknown
    result if the agent is missing or the page cannot be parsed.
    """
    if agent is None:
        return {"provider": provider, "has_balance": False, "remaining": None, "source": "no_agent"}
    urls = {
        "veo": "https://gemini.google.com/app",
        "grok": "https://grok.com",
    }
    url = urls.get(provider) or ""
    task = (
        f"Open {url}. Look for any remaining credits, quota, energy, or 'generations left' "
        "for video / image generation. When you can see a number (or a clear 'out of credits' "
        "or paywall), use action done and put a JSON object in text: "
        '{"provider":"%s","has_balance":true/false,"remaining":number_or_null,"raw":"what you saw"}.'
        % provider
    )
    try:
        result = await agent.run_generic_task(task)
        text = str(result.get("result") or "")
        from vision_loop import _extract_json

        data = _extract_json(text)
        data.setdefault("provider", provider)
        data.setdefault("source", "browser-vision")
        return data
    except Exception as exc:
        logger.warning("credit check %s failed: %s", provider, exc)
        return {"provider": provider, "has_balance": False, "remaining": None, "source": "error", "error": str(exc)[:200]}


async def choose_provider(job_id: str, agent: Any = None) -> dict[str, Any]:
    """Pick veo or grok if the feature is on and a balance looks available."""
    if DRY_RUN:
        decision = {
            "decided": "dry_run_skip",
            "has_balance": False,
            "providers": [],
            "note": "DRY_RUN / credit check skipped",
        }
        record_credit_check(job_id, "none", decision, False, "dry_run_skip")
        return decision

    if not FEATURE_CREDIT_CHECK:
        decision = {
            "decided": "skipped",
            "has_balance": False,
            "providers": [],
            "note": "FEATURE_CREDIT_CHECK=0 (Phase 2, default off)",
        }
        record_credit_check(job_id, "none", decision, False, "skipped")
        return decision

    results = []
    if FEATURE_VEO:
        results.append(await check_gemini_api())
        if agent is not None:
            results.append(await check_via_browser("veo", agent))
    if FEATURE_GROK_IMAGINE and agent is not None:
        results.append(await check_via_browser("grok", agent))

    chosen = None
    for r in results:
        if r.get("has_balance"):
            chosen = r.get("provider")
            break

    decision = {
        "decided": chosen or "none",
        "has_balance": bool(chosen),
        "providers": results,
    }
    record_credit_check(job_id, chosen or "none", decision, bool(chosen), decision["decided"])
    if not chosen:
        decision["note"] = "No provider with a readable balance; pause the generate step."
    return decision
