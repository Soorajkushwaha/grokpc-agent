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
    SCREENSHOT_FORMAT,
    SCREENSHOT_QUALITY,
    SCREENSHOT_TO_UI,
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
- "goto" navigates to url. To open any website, always use "goto" with the full URL.
- You control ONE tab that is already private (incognito-like). Browser shortcuts for new tabs/windows (Ctrl+T, Ctrl+N, Ctrl+Shift+N) do not work; never use them.
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


_KEY_ALIASES = {
    "ctrl": "Control", "control": "Control", "cmd": "Meta", "command": "Meta", "win": "Meta",
    "windows": "Meta", "super": "Meta", "meta": "Meta", "alt": "Alt", "option": "Alt",
    "shift": "Shift", "esc": "Escape", "escape": "Escape", "del": "Delete", "delete": "Delete",
    "enter": "Enter", "return": "Enter", "tab": "Tab", "space": " ", "backspace": "Backspace",
    "up": "ArrowUp", "down": "ArrowDown", "left": "ArrowLeft", "right": "ArrowRight",
    "pageup": "PageUp", "pagedown": "PageDown", "home": "Home", "end": "End",
}


def _normalize_key(key: str) -> str:
    parts = [p.strip() for p in re.split(r"\s*\+\s*", str(key).strip()) if p.strip()]
    out = []
    for p in parts:
        alias = _KEY_ALIASES.get(p.lower())
        if alias:
            out.append(alias)
        elif len(p) == 1:
            out.append(p.lower() if len(parts) > 1 else p)
        else:
            out.append(p[0].upper() + p[1:])
    return "+".join(out) or "Enter"


async def apply_action(page, action: dict[str, Any]) -> str:
    """Apply one model action. `page` may be a Playwright Page or a Driver."""
    try:
        return await _apply_action(page, action)
    except Exception as exc:  # let the model see the error and try something else
        logger.warning("action failed: %s", exc)
        return f"Action failed: {str(exc)[:200]}. Try a different action (e.g. goto with full URL)."


async def _apply_action(page, action: dict[str, Any]) -> str:
    from drivers import as_driver

    driver = as_driver(page)
    kind = (action.get("action") or "done").lower().strip()
    if kind == "goto":
        return await driver.goto(action.get("url") or "")
    if kind == "click":
        x, y = int(action.get("x") or 0), int(action.get("y") or 0)
        return await driver.click(x, y)
    if kind == "type":
        return await driver.type_text(action.get("text") or "")
    if kind == "press":
        key = _normalize_key(action.get("key") or "Enter")
        return await driver.press(key)
    if kind == "scroll":
        amount = int(action.get("amount") or 400)
        return await driver.scroll(amount)
    if kind == "wait":
        ms = int(action.get("amount") or 1000)
        return await driver.wait(ms)
    if kind == "launch":
        app = action.get("text") or action.get("url") or action.get("app") or ""
        return await driver.launch(app)
    if kind == "done":
        return action.get("text") or action.get("thought") or "Done"
    return f"Unknown action {kind}"



async def _capture_screenshot(page) -> tuple[bytes, str]:
    from drivers import as_driver

    driver = as_driver(page)
    return await driver.screenshot()


def _driver_system_note(kind: str) -> str:
    if kind == "windows":
        return (
            "You are driving a Windows desktop (not a browser tab). "
            "Coordinates are screen pixels from the top-left. "
            "Use click/type/press/scroll/launch/wait. "
            "'goto' is not available. 'launch' opens an installed app (e.g. capcut). "
            "Key names: Enter, Tab, Control+i, Alt+F4, Control+s."
        )
    return ""


async def run_vision_task(
    page,
    task: str,
    *,
    log: Optional[LogFn] = None,
    mock: Optional[MockLLM] = None,
    max_steps: Optional[int] = None,
) -> dict[str, Any]:
    import asyncio
    from drivers import as_driver

    driver = as_driver(page)
    steps = max_steps or MAX_VISION_STEPS
    history: list[dict[str, Any]] = []
    last_result = ""
    extra = _driver_system_note(getattr(driver, "kind", "browser"))
    for step in range(1, steps + 1):
        image, mime = await driver.screenshot()
        try:
            url = await driver.current_url()
        except Exception:
            url = ""
        prompt = (
            f"Task: {task}\n"
            f"Step {step}/{steps}. Surface: {getattr(driver, 'kind', 'browser')} URL: {url}\n"
            f"{extra}\n"
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
