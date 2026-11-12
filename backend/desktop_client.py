"""HTTP client for the Windows desktop helper. Short timeouts so a missing
helper never blocks the FFmpeg fallback path.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

import httpx

from config import WINDOWS_HELPER_TOKEN, WINDOWS_HELPER_URL

logger = logging.getLogger("grokpc.helper")


class HelperError(RuntimeError):
    pass


class HelperClient:
    def __init__(self, base_url: Optional[str] = None, token: Optional[str] = None, timeout: float = 5.0):
        self.base_url = (base_url or WINDOWS_HELPER_URL).rstrip("/")
        self.token = token if token is not None else WINDOWS_HELPER_TOKEN
        self.timeout = timeout

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: Optional[dict[str, Any]] = None,
        timeout: Optional[float] = None,
        expect_json: bool = True,
    ) -> Any:
        url = f"{self.base_url}{path}"
        try:
            async with httpx.AsyncClient(timeout=timeout or self.timeout) as client:
                resp = await client.request(method, url, headers=self._headers(), json=json)
        except httpx.HTTPError as exc:
            raise HelperError(f"Windows helper unreachable at {self.base_url}: {exc}") from exc
        if resp.status_code == 401:
            raise HelperError("Windows helper rejected the token")
        if resp.status_code >= 400:
            raise HelperError(f"Windows helper {path} -> {resp.status_code}: {resp.text[:300]}")
        if not expect_json:
            return resp.content, resp.headers.get("content-type") or "application/octet-stream"
        if resp.headers.get("content-type", "").startswith("application/json"):
            return resp.json()
        return {"raw": resp.text}

    async def health(self) -> dict[str, Any]:
        return await self._request("GET", "/health")

    async def reachable(self) -> bool:
        try:
            data = await self.health()
            return bool(data.get("ok") or data.get("status") == "ok")
        except Exception:
            return False

    async def idle(self) -> dict[str, Any]:
        return await self._request("GET", "/idle")

    async def screenshot(self) -> tuple[bytes, str]:
        url = f"{self.base_url}/screenshot"
        try:
            async with httpx.AsyncClient(timeout=max(self.timeout, 8.0)) as client:
                resp = await client.get(url, headers=self._headers(), params={"format": "png"})
        except httpx.HTTPError as exc:
            raise HelperError(f"screenshot failed: {exc}") from exc
        if resp.status_code >= 400:
            # Some versions return JSON {image_b64, mime}
            try:
                data = resp.json()
                import base64

                raw = base64.b64decode(data["image_b64"])
                return raw, data.get("mime") or "image/png"
            except Exception as exc:
                raise HelperError(f"screenshot {resp.status_code}: {resp.text[:200]}") from exc
        ctype = resp.headers.get("content-type") or "image/png"
        if "json" in ctype:
            import base64

            data = resp.json()
            return base64.b64decode(data["image_b64"]), data.get("mime") or "image/png"
        return resp.content, "image/png" if "jpeg" not in ctype else "image/jpeg"

    async def click(self, x: int, y: int, button: str = "left") -> dict[str, Any]:
        return await self._request("POST", "/click", json={"x": int(x), "y": int(y), "button": button})

    async def type_text(self, text: str) -> dict[str, Any]:
        return await self._request("POST", "/type", json={"text": text})

    async def press(self, key: str) -> dict[str, Any]:
        return await self._request("POST", "/press", json={"key": key})

    async def scroll(self, amount: int, x: int = 0, y: int = 0) -> dict[str, Any]:
        return await self._request("POST", "/scroll", json={"amount": int(amount), "x": x, "y": y})

    async def launch(self, app: str, args: Optional[list[str]] = None) -> dict[str, Any]:
        return await self._request(
            "POST", "/launch", json={"app": app, "args": args or []}, timeout=max(self.timeout, 15.0)
        )

    async def import_media(self, paths: list[str], open_folder: bool = True) -> dict[str, Any]:
        return await self._request(
            "POST",
            "/import_media",
            json={"paths": paths, "open_folder": open_folder},
            timeout=max(self.timeout, 20.0),
        )

    async def focus(self, title_contains: str) -> dict[str, Any]:
        return await self._request("POST", "/focus", json={"title_contains": title_contains})

    async def apps(self) -> dict[str, Any]:
        return await self._request("GET", "/apps")


async def helper_status() -> dict[str, Any]:
    client = HelperClient()
    try:
        data = await client.health()
        data["reachable"] = True
        data["url"] = client.base_url
        return data
    except Exception as exc:
        return {"reachable": False, "url": client.base_url, "error": str(exc)[:200]}
