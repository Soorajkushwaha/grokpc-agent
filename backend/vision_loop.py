"""Playwright vision loop: screenshot -> DeepSeek Flash (multimodal) or Gemini fallback -> JSON action."""
from __future__ import annotations

import base64
import json
import logging
import re
from typing import Any, Awaitable, Callable, Optional

import httpx

from config import (
    DEEPSEEK_API_KEY,
    DEEPSEEK_BASE_URL,
    DEEPSEEK_MODEL,
    DRY_RUN,
    GEMINI_API_KEY,
    GEMINI_VISION_MODEL,
    MAX_VISION_STEPS,
)
from db import record_usage

logger = logging.getLogger("grokpc.vision")

LogFn = Callable[[dict[str, Any]], Awaitable[None]]

SYSTEM_PROMPT = """You are a computer-use agent driving a real browser.
You see a screenshot of the current page (viewport 1440x900 unless noted).
Reply with ONE JSON object only, no markdown, no extra text, using this schema:
{
  "action": "click" | "type" | "press" | "scroll" | "goto" | "wait" | "done",
  "x": 0,
  "y": 0,
  "text": "",
  "url": "",
  "key": "Enter",
  "amount": 400,
  "thought": "short reason"
}
Rules:
- Coordinates are in CSS pixels from the top-left of the screenshot.
- "type" types into the currently focused or last-clicked field.
- "press" uses a key name like Enter, Tab, Escape, Backspace.
- "scroll" uses amount in pixels (positive = down).
- "goto" navigates to url.
- "wait" waits amount milliseconds (default 1000).
- "done" when the task is finished or blocked; put the result in "text".
"""


def _extract_json(text: str) -> dict[str, Any]:
    text = (text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{.*\}", text, re.S)
    if match:
        data = json.loads(match.group(0))
        if isinstance(data, dict):
            return data
    raise ValueError(f"Model did not return JSON: {text[:400]}")


def parse_usage(payload: dict[str, Any]) -> tuple[int, int]:
    usage = payload.get("usage") or payload.get("usageMetadata") or {}
    tokens_in = int(
        usage.get("prompt_tokens")
        or usage.get("promptTokenCount")
        or usage.get("input_tokens")
        or 0
    )
    tokens_out = int(
        usage.get("completion_tokens")
        or usage.get("candidatesTokenCount")
        or usage.get("output_tokens")
        or 0
    )
    return tokens_in, tokens_out


class MockLLM:
    """Deterministic actions for smoke tests / DRY_RUN without API keys."""

    def __init__(self, script: Optional[list[dict[str, Any]]] = None):
        self.script = list(
            script
            or [
                {"action": "goto", "url": "about:blank", "thought": "mock start"},
                {"action": "done", "text": "DRY_RUN complete", "thought": "mock done"},
            ]
        )
        self.i = 0

    async def decide(self, prompt: str, screenshot_png: bytes) -> tuple[dict[str, Any], dict[str, Any]]:
        if self.i < len(self.script):
            action = dict(self.script[self.i])
            self.i += 1
        else:
            action = {"action": "done", "text": "DRY_RUN exhausted script", "thought": "end"}
        return action, {"provider": "mock", "model": "mock-llm", "tokens_in": 0, "tokens_out": 0}


async def decide_deepseek(prompt: str, screenshot_png: bytes, mime: str = "image/png") -> tuple[dict[str, Any], dict[str, Any]]:
    b64 = base64.b64encode(screenshot_png).decode("ascii")
    body = {
        "model": DEEPSEEK_MODEL,
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime};base64,{b64}"},
                    },
                ],
            },
        ],
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            f"{DEEPSEEK_BASE_URL.rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
                "Content-Type": "application/json",
            },
            json=body,
        )
        resp.raise_for_status()
        data = resp.json()
    content = data["choices"][0]["message"]["content"]
    tokens_in, tokens_out = parse_usage(data)
    action = _extract_json(content)
    meta = {
        "provider": "deepseek",
        "model": data.get("model") or DEEPSEEK_MODEL,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
    }
    record_usage(
        task_type="vision",
        status="ok",
        details=action.get("thought") or action.get("action") or "",
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        provider="deepseek",
        model=meta["model"],
    )
    return action, meta


async def decide_gemini(prompt: str, screenshot_png: bytes, mime: str = "image/png") -> tuple[dict[str, Any], dict[str, Any]]:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=GEMINI_API_KEY)
    response = await client.aio.models.generate_content(
        model=GEMINI_VISION_MODEL,
        contents=[
            types.Part.from_bytes(data=screenshot_png, mime_type=mime),
            SYSTEM_PROMPT + "\n\nTask:\n" + prompt,
        ],
    )
    text = response.text or ""
    usage = getattr(response, "usage_metadata", None)
    tokens_in = int(getattr(usage, "prompt_token_count", 0) or 0) if usage else 0
    tokens_out = int(getattr(usage, "candidates_token_count", 0) or 0) if usage else 0
    action = _extract_json(text)
    meta = {
        "provider": "gemini",
        "model": GEMINI_VISION_MODEL,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
    }
    record_usage(
        task_type="vision",
        status="ok",
        details=action.get("thought") or action.get("action") or "",
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        provider="gemini",
        model=GEMINI_VISION_MODEL,
    )
    return action, meta


async def decide(prompt: str, screenshot_png: bytes, mock: Optional[MockLLM] = None, mime: str = "image/png") -> tuple[dict[str, Any], dict[str, Any]]:
    if mock is not None:
        return await mock.decide(prompt, screenshot_png)
    if DRY_RUN:
        return await MockLLM().decide(prompt, screenshot_png)
    if DEEPSEEK_API_KEY:
        try:
            return await decide_deepseek(prompt, screenshot_png, mime=mime)
        except Exception as exc:
            logger.warning("DeepSeek vision failed, falling back to Gemini: %s", exc)
    if GEMINI_API_KEY:
        return await decide_gemini(prompt, screenshot_png, mime=mime)
    raise RuntimeError("No vision LLM configured (set DEEPSEEK_API_KEY or GEMINI_API_KEY, or DRY_RUN=1)")


async def apply_action(page, action: dict[str, Any]) -> str:
    kind = (action.get("action") or "done").lower().strip()
    if kind == "goto":
        url = action.get("url") or ""
        await page.goto(url, wait_until="domcontentloaded")
        return f"Navigated to {url}"
    if kind == "click":
        x, y = int(action.get("x") or 0), int(action.get("y") or 0)
        await page.mouse.click(x, y)
        return f"Clicked ({x},{y})"
    if kind == "type":
        text = action.get("text") or ""
        await page.keyboard.type(text, delay=20)
        return f"Typed {len(text)} chars"
    if kind == "press":
        key = action.get("key") or "Enter"
        await page.keyboard.press(key)
        return f"Pressed {key}"
    if kind == "scroll":
        amount = int(action.get("amount") or 400)
        await page.mouse.wheel(0, amount)
        return f"Scrolled {amount}px"
    if kind == "wait":
        import asyncio

        ms = int(action.get("amount") or 1000)
        await asyncio.sleep(ms / 1000)
        return f"Waited {ms}ms"
    if kind == "done":
        return action.get("text") or action.get("thought") or "Done"
    return f"Unknown action {kind}"



async def _capture_screenshot(page) -> tuple[bytes, str]:
    fmt = (SCREENSHOT_FORMAT or "png").lower()
    if fmt in {"jpg", "jpeg"}:
        data = await page.screenshot(type="jpeg", quality=max(1, min(SCREENSHOT_QUALITY, 100)), full_page=False)
        return data, "image/jpeg"
    data = await page.screenshot(type="png", full_page=False)
    return data, "image/png"


async def run_vision_task(
    page,
    task: str,
    *,
    log: Optional[LogFn] = None,
    mock: Optional[MockLLM] = None,
    max_steps: Optional[int] = None,
) -> dict[str, Any]:
    import asyncio

    steps = max_steps or MAX_VISION_STEPS
    history: list[dict[str, Any]] = []
    last_result = ""
    for step in range(1, steps + 1):
        image, mime = await _capture_screenshot(page)
        prompt = (
            f"Task: {task}\n"
            f"Step {step}/{steps}. URL: {page.url}\n"
            f"Last result: {last_result or 'none'}\n"
            "Decide the next single action."
        )
        action, meta = await decide(prompt, image, mock=mock, mime=mime)
        if log:
            payload = {
                "type": "vision",
                "title": f"Vision step {step}: {action.get('action')}",
                "message": action.get("thought") or "",
                "coords": {"x": action.get("x") or 0, "y": action.get("y") or 0},
                "costInr": None,
                "meta": meta,
            }
            if SCREENSHOT_TO_UI and step <= 8:
                payload["screenshotPngB64"] = base64.b64encode(image).decode("ascii")
                payload["screenshotMime"] = mime
            await log(payload)
        last_result = await apply_action(page, action)
        history.append({"step": step, "action": action, "result": last_result, "meta": meta})
        if (action.get("action") or "").lower() == "done":
            return {"status": "success", "result": last_result, "steps": history}
        await asyncio.sleep(0.4)
    return {"status": "max_steps", "result": last_result, "steps": history}
