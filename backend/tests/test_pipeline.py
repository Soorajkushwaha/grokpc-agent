#!/usr/bin/env python3
"""Phase 1 pipeline + jobs API tests. DRY_RUN, no live sites, no API keys."""
from __future__ import annotations

import asyncio
import os
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

TMP = Path(tempfile.mkdtemp(prefix="grokpc-pipe-"))
os.environ.update(
    {
        "AGENT_TOKEN": "test-token-please-ignore",
        "DRY_RUN": "1",
        "HEADLESS": "1",
        "HOST": "127.0.0.1",
        "DB_PATH": str(TMP / "tasks.db"),
        "CHROME_PROFILE_DIR": str(TMP / "chrome"),
        "OUTPUT_DIR": str(TMP / "out"),
        "FRONTEND_ORIGINS": "http://testserver",
        "CHANNELS_PATH": str(TMP / "channels.json"),
        "STYLE_PROFILE_PATH": str(TMP / "style.json"),
        "RUNTIME_SETTINGS_PATH": str(TMP / "settings.json"),
        "WINDOWS_HELPER_URL": "http://127.0.0.1:1",  # nothing listening; fallback must work
        "FEATURE_VEO": "0",
        "FEATURE_GROK_IMAGINE": "0",
        "FEATURE_YOUTUBE_UPLOAD": "0",
        "FEATURE_AUTOPILOT": "0",
        "FEATURE_CREDIT_CHECK": "0",
        "FEATURE_AISTUDIO_VOICE": "0",
        "FEATURE_CAPCUT": "1",
        "FEATURE_CHATGPT_PLANNER": "1",
        "DEEPSEEK_API_KEY": "",
        "GEMINI_API_KEY": "",
    }
)

from fastapi.testclient import TestClient  # noqa: E402

import channels as channels_mod  # noqa: E402
import db as dbmod  # noqa: E402
import jobs as jobs_mod  # noqa: E402
from main import app  # noqa: E402
from planner import mock_plan, normalize_plan, plan_story, plan_with_gemini  # noqa: E402
from scheduler import channel_is_due, in_quiet_hours, should_run_autopilot, under_caps  # noqa: E402
from runtime_settings import save_settings  # noqa: E402

AUTH = {"Authorization": "Bearer test-token-please-ignore"}
failed = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global failed
    if cond:
        print(f"  PASS  {name}")
    else:
        failed += 1
        print(f"  FAIL  {name}  {detail}")


def test_messaging_gone(client: TestClient) -> None:
    print("== messaging removed ==")
    for path, body in (
        ("/api/whatsapp/send", {"contact": "A", "message": "hi"}),
        ("/api/gmail/send", {"recipient": "a@b.c", "subject": "s", "body": "b"}),
        ("/api/approve", {"approval_id": "x", "approved": True}),
    ):
        r = client.post(path, headers=AUTH, json=body)
        check(f"{path} is gone (404)", r.status_code == 404, str(r.status_code) + " " + r.text[:120])


def test_status_and_channels(client: TestClient) -> None:
    print("== status + channels ==")
    r = client.get("/api/status", headers=AUTH)
    check("status 200", r.status_code == 200, r.text[:200])
    body = r.json()
    check("phase is 1", body.get("phase") == 1, str(body.get("phase")))
    flags = body.get("features") or {}
    check("planning on", flags.get("planning") is True, str(flags))
    check("veo off", flags.get("veo") is False, str(flags))
    check("youtube off", flags.get("youtube_upload") is False, str(flags))
    check("autopilot off", flags.get("autopilot") is False, str(flags))
    check("steps are phase 1", body.get("steps") == ["story", "voiceover", "edit"], str(body.get("steps")))

    r = client.get("/api/channels", headers=AUTH)
    chans = r.json().get("channels") or []
    check("3 default channels", r.status_code == 200 and len(chans) == 3, str(len(chans)))
    first = chans[0]["id"]

    r = client.post("/api/channels", headers=AUTH, json={"name": "Channel 4", "language": "Hindi", "niche": "tech"})
    check("add channel", r.status_code == 200 and r.json()["channel"]["name"] == "Channel 4", r.text[:200])
    new_id = r.json()["channel"]["id"]
    r = client.put(f"/api/channels/{new_id}", headers=AUTH, json={"name": "Channel 4b", "language": "Hindi"})
    check("rename channel", r.status_code == 200 and r.json()["channel"]["name"] == "Channel 4b", r.text[:200])
    r = client.delete(f"/api/channels/{new_id}", headers=AUTH)
    check("delete extra channel", r.status_code == 200, r.text[:200])
    r = client.get("/api/channels", headers=AUTH)
    check("back to 3", len(r.json()["channels"]) == 3, str(len(r.json()["channels"])))

    r = client.get("/api/style-profile", headers=AUTH)
    check("style profile", r.status_code == 200 and "Sooraj" in (r.json()["profile"].get("name") or ""), r.text[:200])
    return first


def test_dry_run_pipeline(client: TestClient, channel_id: str) -> None:
    print("== DRY_RUN end-to-end pipeline ==")
    r = client.post(
        "/api/jobs",
        headers=AUTH,
        json={"channel_id": channel_id, "topic": "Paani bachane ke 3 easy tarike", "idea": "short, practical"},
    )
    check("create job 200", r.status_code == 200, r.text[:300])
    job = r.json()["job"]
    job_id = job["id"]
    check("job starts queued or running", job["status"] in {"queued", "running"}, job["status"])
    check("three phase-1 steps", [s["name"] for s in job["steps"]] == ["story", "voiceover", "edit"], str(job["steps"]))

    # Wait for the background runner (TestClient shares the app event loop).
    deadline = time.time() + 60
    final = None
    while time.time() < deadline:
        r = client.get(f"/api/jobs/{job_id}", headers=AUTH)
        final = r.json().get("job")
        if final and final.get("status") in {"completed", "failed", "cancelled"}:
            break
        time.sleep(0.4)
    check("job finished", bool(final) and final.get("status") == "completed", str((final or {}).get("status")) + " " + str((final or {}).get("error")))
    if not final:
        return
    steps = {s["name"]: s for s in final.get("steps") or []}
    check("story success", steps.get("story", {}).get("status") == "success", str(steps.get("story")))
    check("voiceover success", steps.get("voiceover", {}).get("status") == "success", str(steps.get("voiceover")))
    check("edit success", steps.get("edit", {}).get("status") == "success", str(steps.get("edit")))
    final_path = Path(final.get("final_path") or "")
    check("final mp4 exists", final_path.is_file() and final_path.stat().st_size > 500, str(final_path))
    plan = final.get("plan") or {}
    check("plan has voiceover_script", bool(plan.get("voiceover_script")), str(plan.keys()))
    check("plan has scenes", isinstance(plan.get("scenes"), list) and len(plan["scenes"]) >= 3, str(plan.get("scenes")))

    r = client.get(f"/api/jobs/{job_id}/logs", headers=AUTH)
    check("logs non-empty", r.status_code == 200 and len(r.json().get("logs") or []) > 0, r.text[:200])

    r = client.get("/api/jobs", headers=AUTH)
    check("list contains job", any(j["id"] == job_id for j in r.json().get("jobs") or []), r.text[:150])


def test_pause_resume_cancel(client: TestClient, channel_id: str) -> None:
    print("== pause / resume / cancel ==")
    job = jobs_mod.create_job(channel_id=channel_id, topic="pause me")
    job_id = job["id"]
    # Don't kick the runner — pause while queued.
    r = client.post(f"/api/jobs/{job_id}/pause", headers=AUTH)
    check("pause queued job", r.status_code == 200 and r.json()["job"]["status"] == "paused", r.text[:200])
    r = client.post(f"/api/jobs/{job_id}/resume", headers=AUTH)
    check("resume -> queued", r.status_code == 200 and r.json()["job"]["status"] == "queued", r.text[:200])
    # Cancel before the runner grabs it if possible; if it already completed that's ok-ish.
    r = client.post(f"/api/jobs/{job_id}/cancel", headers=AUTH)
    check(
        "cancel returns 200",
        r.status_code == 200 and r.json()["job"]["status"] in {"cancelled", "completed", "running", "queued"},
        r.text[:200],
    )
    # Fresh job just to assert cancel of a queued job for sure: pause first so runner skips it, then cancel.
    job2 = jobs_mod.create_job(channel_id=channel_id, topic="cancel me")
    jobs_mod.pause_job(job2["id"])
    r = client.post(f"/api/jobs/{job2['id']}/cancel", headers=AUTH)
    check("cancel paused job", r.status_code == 200 and r.json()["job"]["status"] == "cancelled", r.text[:200])

    r = client.post(f"/api/jobs/{job2['id']}/approve-publish", headers=AUTH)
    check("approve-publish blocked while Phase 2 off", r.status_code == 409, str(r.status_code) + r.text[:200])


def test_planner_unit() -> None:
    print("== planner unit ==")
    plan = mock_plan("Test topic", {"language": "Hindi"})
    check("mock title", "Test topic" in plan["title"], plan["title"])
    check("mock script", len(plan["voiceover_script"]) > 20, plan["voiceover_script"][:80])
    messy = {"title": "  Hello ", "scenes": [{"narration": "a", "duration_sec": 3}], "tags": ["x"]}
    norm = normalize_plan(messy, "Hello")
    check("normalize fills voiceover", bool(norm["voiceover_script"]), str(norm))
    check("normalize keeps title", norm["title"] == "Hello", norm["title"])

    async def _go():
        return await plan_story("Dry topic", "idea", {"language": "Hindi", "name": "Ch1"}, dry_run=True)

    result = asyncio.run(_go())
    check("plan_story dry_run is mock", result["planner"] == "mock" and result["status"] == "ok", str(result))


def test_plan_with_gemini_mocked() -> None:
    """plan_with_gemini talks to generateContent; no live API, no real keys."""
    import json
    from unittest.mock import AsyncMock, MagicMock, patch

    print("== plan_with_gemini mocked ==")
    plan_obj = {
        "title": "Purani haveli ka raaz",
        "hook": "Ruko — haveli ke andar kuch hai.",
        "story": "Ek short mystery.",
        "scenes": [
            {
                "id": 1,
                "narration": "Namaste.",
                "visual": "Haveli",
                "image_prompt": "old mansion",
                "video_prompt": "slow pan",
                "duration_sec": 5,
            }
        ],
        "voiceover_script": "Namaste dosto.",
        "thumbnail_prompt": "haveli thumbnail",
        "tags": ["haveli"],
        "description": "A mystery.",
    }
    payload = {
        "candidates": [{"content": {"parts": [{"text": json.dumps(plan_obj)}]}}],
        "usageMetadata": {"promptTokenCount": 11, "candidatesTokenCount": 22},
    }
    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = payload
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_resp)
    mock_client.__aenter__.return_value = mock_client
    mock_client.__aexit__.return_value = False

    async def _go():
        with (
            patch("planner.httpx.AsyncClient", return_value=mock_client),
            patch("planner.GEMINI_API_KEY", "fake-test-key-not-real"),
        ):
            return await plan_with_gemini("Plan a short Hindi mystery video")

    plan, meta = asyncio.run(_go())
    check("gemini provider", meta.get("provider") == "gemini", str(meta))
    check("gemini cost_inr is 0", meta.get("cost_inr") == 0, str(meta))
    check("gemini tokens parsed", meta.get("tokens_in") == 11 and meta.get("tokens_out") == 22, str(meta))
    check("gemini title from JSON", plan.get("title") == "Purani haveli ka raaz", str(plan.get("title")))
    args, kwargs = mock_client.post.call_args
    url = args[0] if args else kwargs.get("url", "")
    check(
        "generateContent v1beta URL",
        "generativelanguage.googleapis.com/v1beta/models/" in url and url.endswith(":generateContent"),
        url,
    )
    headers = kwargs.get("headers") or {}
    check("x-goog-api-key header", headers.get("x-goog-api-key") == "fake-test-key-not-real", str(headers))
    body = kwargs.get("json") or {}
    mime = (body.get("generationConfig") or {}).get("responseMimeType")
    check("responseMimeType application/json", mime == "application/json", str(body.get("generationConfig")))


def test_scheduler_unit() -> None:
    print("== scheduler (Phase 2 logic, flag off) ==")
    import datetime as dt

    now = dt.datetime(2026, 11, 12, 23, 30)  # Thursday 23:30
    check("quiet 23-07 at 23:30", in_quiet_hours({"quiet_hours": "23:00-07:00"}, now=now) is True)
    morning = dt.datetime(2026, 11, 13, 8, 0)
    check("quiet 23-07 at 08:00", in_quiet_hours({"quiet_hours": "23:00-07:00"}, now=morning) is False)
    midday = dt.datetime(2026, 11, 12, 12, 0)
    check("quiet 09-17 at 12:00", in_quiet_hours({"quiet_hours": "09:00-17:00"}, now=midday) is True)

    ch = {"enabled": True, "schedule": {"days": ["thu"], "time": "18:00"}}
    check("channel due Thursday 19:00", channel_is_due(ch, now=dt.datetime(2026, 11, 12, 19, 0)) is True)
    check("channel not due Thursday 10:00", channel_is_due(ch, now=dt.datetime(2026, 11, 12, 10, 0)) is False)
    check("channel not due Friday", channel_is_due(ch, now=dt.datetime(2026, 11, 13, 19, 0)) is False)

    ok, reason = should_run_autopilot({"autopilot_enabled": True, "quiet_hours": "23:00-07:00", "daily_video_cap": 3, "daily_spend_cap_inr": 40})
    check("autopilot flag off blocks", ok is False and "FEATURE_AUTOPILOT" in reason, reason)


def test_path_helpers() -> None:
    print("== path helpers + drivers ==")
    from editors import wsl_to_windows
    from drivers import BrowserDriver, as_driver

    check("wsl path", wsl_to_windows("/mnt/c/Users/Sooraj/Videos/a.mp4") == r"C:\Users\Sooraj\Videos\a.mp4")
    check("plain path passthrough", wsl_to_windows(r"C:\x") == r"C:\x")

    class DummyPage:
        url = "https://example.com"

        async def screenshot(self, **kwargs):
            return b"PNG"

    d = as_driver(DummyPage())
    check("as_driver wraps page", isinstance(d, BrowserDriver) and d.kind == "browser")
    already = BrowserDriver(DummyPage())
    check("as_driver is idempotent", as_driver(already) is already)


def test_task_still_works(client: TestClient) -> None:
    print("== /api/task still accepted ==")
    r = client.post("/api/task", headers=AUTH, json={"prompt": "google.com kholo"})
    check("task accepted", r.status_code == 200 and r.json().get("status") == "started", r.text[:200])
    r = client.post("/api/task", headers=AUTH, json={"prompt": "   "})
    check("empty task 400", r.status_code == 400, str(r.status_code))
    r = client.post("/api/task", json={"prompt": "hi"})
    check("task without token 401", r.status_code == 401, str(r.status_code))


def test_auth_on_new_routes(client: TestClient) -> None:
    print("== auth on new routes ==")
    for path in ("/api/status", "/api/jobs", "/api/channels", "/api/credits", "/api/autopilot", "/api/settings"):
        r = client.get(path)
        check(f"{path} 401", r.status_code == 401, str(r.status_code))


def main() -> int:
    print(f"temp dir: {TMP}")
    dbmod.init_db()
    channels_mod.ensure_defaults()
    with TestClient(app) as client:
        test_auth_on_new_routes(client)
        test_messaging_gone(client)
        channel_id = test_status_and_channels(client)
        test_task_still_works(client)
        test_planner_unit()
        test_plan_with_gemini_mocked()
        test_scheduler_unit()
        test_path_helpers()
        test_dry_run_pipeline(client, channel_id)
        test_pause_resume_cancel(client, channel_id)
    print(f"\n{'ALL PASSED' if failed == 0 else f'{failed} FAILED'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
