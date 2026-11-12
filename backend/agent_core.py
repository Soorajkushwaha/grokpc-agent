"""Playwright persistent browser + vision-loop tasks (the path that already opened YouTube)."""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Awaitable, Callable, Optional

from config import (
    ANDROID, CDP_URL, CHROME_PROFILE_DIR, CHROMIUM_PATH, DRY_RUN, HEADLESS,
    LOW_MEMORY, VIEWPORT_HEIGHT, VIEWPORT_WIDTH,
)
from vision_loop import MockLLM, run_vision_task

try:
    from playwright.async_api import BrowserContext, Page, async_playwright  # type: ignore
    PLAYWRIGHT_AVAILABLE = True
except ImportError:  # tablet / Termux worker has no Playwright
    BrowserContext = Any  # type: ignore[misc,assignment]
    Page = Any  # type: ignore[misc,assignment]
    async_playwright = None  # type: ignore[assignment]
    PLAYWRIGHT_AVAILABLE = False

logger = logging.getLogger("grokpc.agent")

LogFn = Callable[[dict[str, Any]], Awaitable[None]]


class BrowserAgentCore:
    def __init__(self, log_callback: Optional[LogFn] = None):
        self.log_callback = log_callback
        self.playwright = None
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None
        self.is_busy = False
        self._lock = asyncio.Lock()
        self._external_browser = False  # CDP-attached; do not kill Chromium on close

    async def emit(self, typ: str, title: str, message: str, **extra: Any) -> None:
        payload = {"type": typ, "title": title, "message": message, **extra}
        logger.info("[%s] %s: %s", typ, title, message)
        if self.log_callback:
            await self.log_callback(payload)

    async def initialize_browser(self, headless: Optional[bool] = None) -> BrowserContext:
        if self.context:
            return self.context
        if not PLAYWRIGHT_AVAILABLE or async_playwright is None:
            raise RuntimeError(
                "Playwright is not installed on this worker. "
                "Browser visuals and /api/task are unavailable; "
                "the video pipeline still runs with Gemini/gTTS/FFmpeg fallback visuals."
            )
        os.makedirs(CHROME_PROFILE_DIR, exist_ok=True)
        await self.emit("system", "Launching browser", f"Profile {CHROME_PROFILE_DIR}")
        self.playwright = await async_playwright().start()
        launch_headless = HEADLESS if headless is None else headless
        chrome_args = [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--disable-extensions",
            "--disable-blink-features=AutomationControlled",
            "--renderer-process-limit=3",
            "--disable-background-networking",
            "--disable-sync",
            "--disable-translate",
            "--mute-audio",
            "--no-first-run",
        ]
        if LOW_MEMORY or ANDROID:
            chrome_args += [
                "--js-flags=--max-old-space-size=384",
                "--renderer-process-limit=2",
                "--disable-features=Translate,BackForwardCache,MediaRouter,DialMediaRouteProvider,CalculateNativeWinOcclusion",
                "--disk-cache-size=67108864",
                "--force-device-scale-factor=1",
            ]

        if CDP_URL:
            # Preferred on Termux: attach to a system Chromium we already started.
            last_err: Exception | None = None
            for attempt in range(1, 16):
                try:
                    browser = await self.playwright.chromium.connect_over_cdp(CDP_URL)
                    self._external_browser = True
                    self.context = browser.contexts[0] if browser.contexts else await browser.new_context(
                        viewport={"width": VIEWPORT_WIDTH, "height": VIEWPORT_HEIGHT}
                    )
                    pages = self.context.pages
                    self.page = pages[0] if pages else await self.context.new_page()
                    try:
                        await self.page.set_viewport_size({"width": VIEWPORT_WIDTH, "height": VIEWPORT_HEIGHT})
                    except Exception:
                        pass
                    await self.emit("system", "Browser ready", f"cdp={CDP_URL} low_mem={LOW_MEMORY} {VIEWPORT_WIDTH}x{VIEWPORT_HEIGHT}")
                    return self.context
                except Exception as exc:
                    last_err = exc
                    await self.emit("system", "CDP wait", f"attempt {attempt}/15: {exc}")
                    await asyncio.sleep(2)
            raise RuntimeError(f"Could not connect to Chromium at {CDP_URL}: {last_err}")

        # Bundled Chromium (VPS / WSL) or a system binary via CHROMIUM_PATH (Termux fallback).
        if CHROMIUM_PATH:
            os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "0")
        launch_kwargs: dict[str, Any] = dict(
            user_data_dir=CHROME_PROFILE_DIR,
            headless=launch_headless,
            viewport={"width": VIEWPORT_WIDTH, "height": VIEWPORT_HEIGHT},
            args=chrome_args,
        )
        if CHROMIUM_PATH:
            launch_kwargs["executable_path"] = CHROMIUM_PATH
        self.context = await self.playwright.chromium.launch_persistent_context(**launch_kwargs)
        pages = self.context.pages
        self.page = pages[0] if pages else await self.context.new_page()
        how = f"executable_path={CHROMIUM_PATH}" if CHROMIUM_PATH else "bundled"
        await self.emit("system", "Browser ready", f"{how} headless={launch_headless} low_mem={LOW_MEMORY} {VIEWPORT_WIDTH}x{VIEWPORT_HEIGHT}")
        return self.context

    async def close(self) -> None:
        if self._external_browser:
            # Leave the system Chromium (and its profile) running for noVNC / next task.
            self.context = None
            self.page = None
        elif self.context:
            await self.context.close()
            self.context = None
            self.page = None
        if self.playwright:
            await self.playwright.stop()
            self.playwright = None
        self._external_browser = False

    @asynccontextmanager
    async def exclusive_page(self) -> AsyncIterator[Page]:
        """Yield a fresh tab on the existing persistent profile.

        Holds the agent lock so the vision loop and the visuals step never
        launch a second persistent context (Chromium would refuse the profile).
        """
        async with self._lock:
            self.is_busy = True
            page: Optional[Page] = None
            try:
                await self.initialize_browser()
                if self.context is None:
                    raise RuntimeError("browser context was not created")
                page = await self.context.new_page()
                try:
                    await page.set_viewport_size({"width": VIEWPORT_WIDTH, "height": VIEWPORT_HEIGHT})
                except Exception:
                    pass
                yield page
            finally:
                if page is not None:
                    try:
                        await page.close()
                    except Exception:
                        pass
                self.is_busy = False

    async def open_visible_url(self, url: str) -> dict[str, Any]:
        """Open a URL in the persistent visible Chrome profile. Does not type or click.

        Leaves the tab open so the user can log in over noVNC. Reuses the
        already-launched context when the agent holds the profile lock.
        """
        async with self._lock:
            self.is_busy = True
            try:
                await self.initialize_browser(headless=False)
                if self.context is None:
                    raise RuntimeError("browser context was not created")
                page = await self.context.new_page()
                try:
                    await page.set_viewport_size({"width": VIEWPORT_WIDTH, "height": VIEWPORT_HEIGHT})
                except Exception:
                    pass
                await page.goto(url, wait_until="domcontentloaded", timeout=60_000)
                self.page = page
                await self.emit("system", "Opened URL", page.url)
                return {"ok": True, "url": page.url, "title": await page.title()}
            finally:
                self.is_busy = False

    async def run_generic_task(self, task: str, mock: Optional[MockLLM] = None) -> dict[str, Any]:
        async with self._lock:
            self.is_busy = True
            try:
                await self.initialize_browser()
                await self.emit("action", "Task started", task)
                result = await run_vision_task(self.page, task, log=self.log_callback, mock=mock)
                await self.emit("action", "Task finished", result.get("result") or result.get("status") or "")
                return result
            finally:
                self.is_busy = False
