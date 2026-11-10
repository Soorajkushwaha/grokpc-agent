"""Playwright persistent browser + WhatsApp/Gmail helpers + vision-loop tasks."""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Awaitable, Callable, Optional

from playwright.async_api import BrowserContext, Page, async_playwright

from config import CHROME_PROFILE_DIR, DRY_RUN, HEADLESS, LOW_MEMORY, VIEWPORT_HEIGHT, VIEWPORT_WIDTH
from vision_loop import MockLLM, run_vision_task

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

    async def emit(self, typ: str, title: str, message: str, **extra: Any) -> None:
        payload = {"type": typ, "title": title, "message": message, **extra}
        logger.info("[%s] %s: %s", typ, title, message)
        if self.log_callback:
            await self.log_callback(payload)

    async def initialize_browser(self, headless: Optional[bool] = None) -> BrowserContext:
        if self.context:
            return self.context
        os.makedirs(CHROME_PROFILE_DIR, exist_ok=True)
        await self.emit("system", "Launching browser", f"Profile {CHROME_PROFILE_DIR}")
        self.playwright = await async_playwright().start()
        launch_headless = HEADLESS if headless is None else headless
        # Use the bundled Chromium (playwright install chromium). Do not set channel=
        # and do not spoof an x86_64 UA on Ampere ARM64.
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
        if LOW_MEMORY:
            chrome_args += [
                "--js-flags=--max-old-space-size=384",
                "--renderer-process-limit=2",
                "--disable-features=Translate,BackForwardCache,MediaRouter,DialMediaRouteProvider,CalculateNativeWinOcclusion",
                "--disk-cache-size=67108864",
                "--force-device-scale-factor=1",
            ]
        self.context = await self.playwright.chromium.launch_persistent_context(
            user_data_dir=CHROME_PROFILE_DIR,
            headless=launch_headless,
            viewport={"width": VIEWPORT_WIDTH, "height": VIEWPORT_HEIGHT},
            args=chrome_args,
        )
        pages = self.context.pages
        self.page = pages[0] if pages else await self.context.new_page()
        await self.emit("system", "Browser ready", f"headless={launch_headless} low_mem={LOW_MEMORY} {VIEWPORT_WIDTH}x{VIEWPORT_HEIGHT}")
        return self.context

    async def close(self) -> None:
        if self.context:
            await self.context.close()
            self.context = None
            self.page = None
        if self.playwright:
            await self.playwright.stop()
            self.playwright = None

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

    async def run_whatsapp_send(self, contact: str, message: str, file_path: Optional[str] = None) -> dict[str, Any]:
        """Best-effort WhatsApp Web send using the persistent profile. Call only after approval."""
        async with self._lock:
            self.is_busy = True
            try:
                await self.initialize_browser()
                assert self.page is not None
                await self.emit("action", "WhatsApp Web", f"Opening chat for {contact}")
                await self.page.goto("https://web.whatsapp.com", wait_until="domcontentloaded")
                await asyncio.sleep(4)
                qr = await self.page.query_selector("canvas[aria-label*='QR'], canvas[aria-label*='qr']")
                if qr:
                    await self.emit(
                        "approval",
                        "WhatsApp Auth Required",
                        "Scan the QR code in the live desktop (noVNC), then retry.",
                    )
                    return {"status": "auth_required", "message": "Scan WhatsApp QR in noVNC"}

                search = await self.page.wait_for_selector(
                    "div[contenteditable='true'][data-tab='3'], div[title='Search input textbox'], [data-testid='chat-list-search']",
                    timeout=20000,
                )
                await search.click()
                await self.page.keyboard.type(contact, delay=30)
                await asyncio.sleep(1.2)
                await self.page.keyboard.press("Enter")
                await asyncio.sleep(1.5)

                box = await self.page.wait_for_selector(
                    "div[contenteditable='true'][data-tab='10'], footer div[contenteditable='true'], [data-testid='conversation-compose-box-input']",
                    timeout=15000,
                )
                await box.click()
                await self.page.keyboard.type(message, delay=20)

                if file_path and os.path.exists(file_path):
                    file_input = await self.page.query_selector("input[type='file']")
                    if file_input:
                        await file_input.set_input_files(file_path)
                        await asyncio.sleep(2)

                await self.page.keyboard.press("Enter")
                await asyncio.sleep(1.5)
                await self.emit("action", "WhatsApp Sent", f"Sent to {contact}")
                return {"status": "success", "contact": contact}
            except Exception as exc:
                logger.exception("WhatsApp send failed")
                # Fall back to the vision loop so a changed DOM can still be handled.
                await self.emit("system", "Selector miss", f"{exc}; switching to vision loop")
                task = f"On WhatsApp Web, open the chat with '{contact}' and send this message exactly: {message}"
                return await run_vision_task(self.page, task, log=self.log_callback)
            finally:
                self.is_busy = False

    async def run_gmail_send(self, recipient: str, subject: str, body: str) -> dict[str, Any]:
        """Best-effort Gmail compose. Call only after approval."""
        async with self._lock:
            self.is_busy = True
            try:
                await self.initialize_browser()
                assert self.page is not None
                await self.emit("action", "Gmail", f"Composing email to {recipient}")
                await self.page.goto("https://mail.google.com/mail/u/0/#inbox", wait_until="domcontentloaded")
                await asyncio.sleep(3)
                if "accounts.google.com" in (self.page.url or ""):
                    await self.emit(
                        "approval",
                        "Gmail Auth Required",
                        "Log into Google in the live desktop (noVNC), then retry.",
                    )
                    return {"status": "auth_required", "message": "Log into Gmail in noVNC"}
                compose = self.page.locator("div[gh='cm'], div[role='button']:has-text('Compose')").first
                await compose.click(timeout=15000)
                await asyncio.sleep(1)
                to_box = self.page.locator("input[peoplekit-id], textarea[name='to'], input[aria-label*='To']").first
                await to_box.fill(recipient)
                subj = self.page.locator("input[name='subjectbox']").first
                await subj.fill(subject)
                body_box = self.page.locator("div[aria-label='Message Body'], div[role='textbox'][aria-label*='Body']").first
                await body_box.click()
                await self.page.keyboard.type(body, delay=15)
                await self.page.keyboard.press("Control+Enter")
                await asyncio.sleep(2)
                await self.emit("action", "Gmail Sent", f"Sent to {recipient}")
                return {"status": "success", "recipient": recipient}
            except Exception as exc:
                logger.exception("Gmail send failed")
                await self.emit("system", "Selector miss", f"{exc}; switching to vision loop")
                task = (
                    f"In Gmail, compose and send an email to {recipient} "
                    f"with subject '{subject}' and body: {body}"
                )
                return await run_vision_task(self.page, task, log=self.log_callback)
            finally:
                self.is_busy = False
