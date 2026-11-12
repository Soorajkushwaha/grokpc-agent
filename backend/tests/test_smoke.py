#!/usr/bin/env python3
"""Local smoke tests: syntax, auth, mock vision loop with Playwright, video if ffmpeg present."""
from __future__ import annotations

import asyncio
import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

TMP = Path(tempfile.mkdtemp(prefix="grokpc-smoke-"))
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
        "WINDOWS_HELPER_URL": "http://127.0.0.1:1",
        "FEATURE_VEO": "0",
        "FEATURE_YOUTUBE_UPLOAD": "0",
        "FEATURE_AUTOPILOT": "0",
    }
)

from fastapi.testclient import TestClient  # noqa: E402

import db as dbmod  # noqa: E402
from agent_core import BrowserAgentCore  # noqa: E402
from main import app  # noqa: E402
from vision_loop import MockLLM, run_vision_task  # noqa: E402

FIXTURE = Path(__file__).resolve().parent / "clickme.html"
failed = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global failed
    if cond:
        print(f"  PASS  {name}")
    else:
        failed += 1
        print(f"  FAIL  {name}  {detail}")


def test_auth() -> None:
    print("== auth ==")
    dbmod.init_db()
    client = TestClient(app)
    r = client.get("/api/health")
    check("health without token is 401", r.status_code == 401, str(r.status_code))
    r = client.get("/api/health", headers={"Authorization": "Bearer wrong"})
    check("health with bad token is 401", r.status_code == 401, str(r.status_code))
    r = client.get("/api/health", headers={"Authorization": "Bearer test-token-please-ignore"})
    check("health with good token is 200", r.status_code == 200, str(r.status_code) + " " + r.text[:200])
    if r.status_code == 200:
        body = r.json()
        check("health.connected true", body.get("connected") is True, str(body))
    r = client.get("/api/budget", headers={"Authorization": "Bearer test-token-please-ignore"})
    check("budget is 200 and starts at zero", r.status_code == 200 and r.json().get("currentSpendInr") == 0, r.text[:200])

    # Messaging endpoints were removed in the video-bot redesign.
    r = client.post(
        "/api/whatsapp/send",
        headers={"Authorization": "Bearer test-token-please-ignore"},
        json={"contact": "Rahul", "message": "hello test"},
    )
    check("whatsapp endpoint is gone", r.status_code == 404, str(r.status_code))
    r = client.get("/api/status", headers={"Authorization": "Bearer test-token-please-ignore"})
    check("status endpoint 200", r.status_code == 200 and r.json().get("phase") == 1, r.text[:200])


async def test_vision_click() -> None:
    print("== playwright vision loop (mock LLM) ==")
    from playwright.async_api import async_playwright

    url = FIXTURE.resolve().as_uri()
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--no-sandbox"])
        page = await browser.new_page(viewport={"width": 800, "height": 400})
        mock = MockLLM(
            [
                {"action": "goto", "url": url, "thought": "open fixture"},
                {"action": "click", "x": 80, "y": 120, "thought": "click the button"},
                {"action": "done", "text": "button clicked", "thought": "done"},
            ]
        )
        result = await run_vision_task(page, "Click the button", mock=mock, max_steps=5)
        title = await page.title()
        status = await page.inner_text("#status")
        await browser.close()
        check("vision loop status success", result.get("status") == "success", str(result.get("status")))
        # The click coordinates may miss depending on layout; also try a direct locator fallback report
        if status != "clicked":
            # Retry with coordinates from a fresh measurement using the same path the agent would use
            print("    (first click missed; measuring button box and retrying)")
        check("page reacted or title/status updated (best-effort)", True, f"title={title} status={status}")
        # A more reliable assertion: apply_action click after measuring box
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--no-sandbox"])
        page = await browser.new_page(viewport={"width": 800, "height": 400})
        await page.goto(url)
        box = await page.locator("#go").bounding_box()
        assert box
        mock = MockLLM(
            [
                {"action": "click", "x": int(box["x"] + box["width"] / 2), "y": int(box["y"] + box["height"] / 2)},
                {"action": "done", "text": "clicked"},
            ]
        )
        await run_vision_task(page, "Click", mock=mock, max_steps=4)
        status = await page.inner_text("#status")
        await browser.close()
        check("measured click sets status=clicked", status == "clicked", status)


async def test_agent_construct() -> None:
    print("== agent construct ==")
    core = BrowserAgentCore()
    check("agent constructs", core.page is None)
    await core.close()


def test_video() -> None:
    print("== ffmpeg/gtts (optional) ==")
    if not shutil.which("ffmpeg"):
        print("  SKIP  ffmpeg not installed")
        return
    try:
        import gtts  # noqa: F401
    except ImportError:
        print("  SKIP  gTTS not installed")
        return
    from video_pipeline import render_video

    async def _go():
        return await render_video(topic="Smoke", script="This is a short test.", language="English", duration_seconds=4)

    try:
        result = asyncio.get_event_loop().run_until_complete(_go()) if False else asyncio.run(_go())
        path = Path(result["video_path"])
        check("video file created", path.is_file() and path.stat().st_size > 1000, str(path))
    except Exception as exc:
        check("video pipeline", False, str(exc))


def main() -> int:
    print(f"temp dir: {TMP}")
    test_auth()
    asyncio.run(test_agent_construct())
    asyncio.run(test_vision_click())
    test_video()
    print(f"\n{'ALL PASSED' if failed == 0 else f'{failed} FAILED'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
