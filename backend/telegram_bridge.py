"""Optional Telegram long-polling for approve/reject. Only runs if token+chat id are set."""
from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable, Optional

import httpx

from config import TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

logger = logging.getLogger("grokpc.telegram")

ApproveFn = Callable[[str, bool, Optional[str]], Awaitable[None]]


class TelegramBridge:
    def __init__(self, on_decision: ApproveFn):
        self.on_decision = on_decision
        self._task: Optional[asyncio.Task] = None
        self._offset = 0

    @property
    def enabled(self) -> bool:
        return bool(TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)

    async def send_approval(self, approval_id: str, title: str, recipient: str, content: str) -> None:
        if not self.enabled:
            return
        text = (
            f"AI Agent approval required\n\n"
            f"Task: {title}\n"
            f"Recipient: {recipient}\n"
            f"Content:\n{content}\n\n"
            f"Only the configured chat can approve."
        )
        keyboard = {
            "inline_keyboard": [
                [
                    {"text": "Approve & Send", "callback_data": f"approve:{approval_id}"},
                    {"text": "Reject", "callback_data": f"reject:{approval_id}"},
                ]
            ]
        }
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        async with httpx.AsyncClient(timeout=20.0) as client:
            try:
                await client.post(
                    url,
                    json={
                        "chat_id": TELEGRAM_CHAT_ID,
                        "text": text,
                        "reply_markup": keyboard,
                    },
                )
            except Exception as exc:
                logger.warning("Telegram send failed: %s", exc)

    async def start(self) -> None:
        if not self.enabled:
            logger.info("Telegram bridge disabled (no TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)")
            return
        self._task = asyncio.create_task(self._poll(), name="telegram-poll")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None

    async def _poll(self) -> None:
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/getUpdates"
        logger.info("Telegram long polling started (restricted to chat %s)", TELEGRAM_CHAT_ID)
        while True:
            try:
                async with httpx.AsyncClient(timeout=40.0) as client:
                    resp = await client.get(
                        url,
                        params={"timeout": 25, "offset": self._offset, "allowed_updates": '["callback_query"]'},
                    )
                    data = resp.json()
                for update in data.get("result") or []:
                    self._offset = int(update["update_id"]) + 1
                    cb = update.get("callback_query") or {}
                    msg_chat = str(((cb.get("message") or {}).get("chat") or {}).get("id") or "")
                    from_id = str(((cb.get("from") or {}).get("id") or ""))
                    if msg_chat != str(TELEGRAM_CHAT_ID) and from_id != str(TELEGRAM_CHAT_ID):
                        logger.warning("Ignoring Telegram callback from unexpected chat %s", msg_chat or from_id)
                        continue
                    payload = cb.get("data") or ""
                    if payload.startswith("approve:") or payload.startswith("reject:"):
                        kind, _, approval_id = payload.partition(":")
                        await self.on_decision(approval_id, kind == "approve", None)
                    # answer callback to clear the spinner
                    if cb.get("id"):
                        try:
                            async with httpx.AsyncClient(timeout=10.0) as client:
                                await client.post(
                                    f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/answerCallbackQuery",
                                    json={"callback_query_id": cb["id"], "text": "Recorded"},
                                )
                        except Exception:
                            pass
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("Telegram poll error: %s", exc)
                await asyncio.sleep(5)
