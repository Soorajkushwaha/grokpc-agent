"""Vision-loop drivers: Playwright browser, and Windows desktop via the helper.

The vision loop talks only to this interface, so DeepSeek can drive either a
browser tab (Phase 1, already working) or the Windows desktop (CapCut).
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional, Protocol

from config import (
    SCREENSHOT_FORMAT,
    SCREENSHOT_QUALITY,
)

logger = logging.getLogger("grokpc.drivers")


class Driver(Protocol):
    kind: str

    async def screenshot(self) -> tuple[bytes, str]: ...
    async def current_url(self) -> str: ...
    async def goto(self, url: str) -> str: ...
    async def click(self, x: int, y: int) -> str: ...
    async def type_text(self, text: str) -> str: ...
    async def press(self, key: str) -> str: ...
    async def scroll(self, amount: int) -> str: ...
    async def wait(self, ms: int) -> str: ...
    async def launch(self, app: str, args: Optional[list[str]] = None) -> str: ...


class BrowserDriver:
    """Wraps a Playwright Page. This is the path that already opened YouTube."""

    kind = "browser"

    def __init__(self, page: Any):
        self.page = page

    async def screenshot(self) -> tuple[bytes, str]:
        fmt = (SCREENSHOT_FORMAT or "png").lower()
        if fmt in {"jpg", "jpeg"}:
            data = await self.page.screenshot(
                type="jpeg",
                quality=max(1, min(SCREENSHOT_QUALITY, 100)),
                full_page=False,
            )
            return data, "image/jpeg"
        data = await self.page.screenshot(type="png", full_page=False)
        return data, "image/png"

    async def current_url(self) -> str:
        try:
            return self.page.url or ""
        except Exception:
            return ""

    async def goto(self, url: str) -> str:
        url = (url or "").strip()
        if url and "://" not in url and not url.startswith("about:"):
            url = "https://" + url
        await self.page.goto(url, wait_until="domcontentloaded")
        return f"Navigated to {url}"

    async def click(self, x: int, y: int) -> str:
        await self.page.mouse.click(x, y)
        return f"Clicked ({x},{y})"

    async def type_text(self, text: str) -> str:
        await self.page.keyboard.type(text or "", delay=20)
        return f"Typed {len(text or '')} chars"

    async def press(self, key: str) -> str:
        from vision_loop import _normalize_key

        key = _normalize_key(key or "Enter")
        await self.page.keyboard.press(key)
        return f"Pressed {key}"

    async def scroll(self, amount: int) -> str:
        await self.page.mouse.wheel(0, amount)
        return f"Scrolled {amount}px"

    async def wait(self, ms: int) -> str:
        await asyncio.sleep(max(0, ms) / 1000)
        return f"Waited {ms}ms"

    async def launch(self, app: str, args: Optional[list[str]] = None) -> str:
        return f"launch is not available in the browser driver (asked for {app})"


class WindowsDesktopDriver:
    """Talks to the Windows-session helper (windows/desktop_helper)."""

    kind = "windows"

    def __init__(self, client: Optional[Any] = None):
        self.client = client

    def _client(self):
        if self.client is None:
            from desktop_client import HelperClient

            self.client = HelperClient()
        return self.client

    async def screenshot(self) -> tuple[bytes, str]:
        return await self._client().screenshot()

    async def current_url(self) -> str:
        info = await self._client().health()
        title = (info or {}).get("foreground_title") or "Windows desktop"
        return f"windows://{title}"

    async def goto(self, url: str) -> str:
        # Opening a URL from the Windows side uses the user's default browser,
        # which we generally want to avoid. Prefer the Playwright driver.
        return f"goto is not supported on the Windows desktop driver ({url})"

    async def click(self, x: int, y: int) -> str:
        await self._client().click(x, y)
        return f"Clicked ({x},{y}) on Windows"

    async def type_text(self, text: str) -> str:
        await self._client().type_text(text or "")
        return f"Typed {len(text or '')} chars on Windows"

    async def press(self, key: str) -> str:
        await self._client().press(key or "Enter")
        return f"Pressed {key} on Windows"

    async def scroll(self, amount: int) -> str:
        await self._client().scroll(amount)
        return f"Scrolled {amount} on Windows"

    async def wait(self, ms: int) -> str:
        await asyncio.sleep(max(0, ms) / 1000)
        return f"Waited {ms}ms"

    async def launch(self, app: str, args: Optional[list[str]] = None) -> str:
        result = await self._client().launch(app, args or [])
        return f"Launched {app}: {result}"


def as_driver(target: Any) -> Driver:
    """Accept a Driver, or a raw Playwright Page (backward compatible)."""
    if target is None:
        raise ValueError("vision loop needs a driver or Playwright page")
    if isinstance(target, (BrowserDriver, WindowsDesktopDriver)):
        return target
    if hasattr(target, "kind") and hasattr(target, "screenshot") and hasattr(target, "click"):
        return target  # type: ignore[return-value]
    return BrowserDriver(target)
