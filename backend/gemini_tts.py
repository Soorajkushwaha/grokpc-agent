"""Robust Gemini TTS: SDK when it works, otherwise a direct REST call.

Old google-genai builds (common on Termux) serialize SpeechConfig into
generation_config.speechConfig in a way some models reject with
400 INVALID_ARGUMENT "Unknown name speechConfig". A plain httpx POST to
:generateContent with the documented JSON avoids that.

Quota and rate-limit errors are classified so the pipeline can back off,
keep Charon consistent, and tell the user when the free daily quota is gone
instead of silently switching the whole job to edge-tts.
"""
from __future__ import annotations

import asyncio
import base64
import inspect
import json
import logging
import random
import re
from dataclasses import dataclass, field
from typing import Any, Optional

import httpx

logger = logging.getLogger("grokpc.gemini_tts")

GEMINI_GENERATE_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
)
PCM_RATE = 24000

# Input packing limit per TTS request. Gemini accepts more, but shorter
# chunks fail less often, stay under audio-output caps, and retry cheaply.
MAX_TTS_CHARS = 480
MAX_TTS_WORDS = 90


class GeminiTTSError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        status: int = 0,
        quota_id: str = "",
        quota_metric: str = "",
        quota_limit: str = "",
        reason: str = "",
        retry_delay: float = 0.0,
        daily: bool = False,
        rate_limit: bool = False,
        raw: Any = None,
    ):
        super().__init__(message)
        self.status = status
        self.quota_id = quota_id
        self.quota_metric = quota_metric
        self.quota_limit = quota_limit
        self.reason = reason
        self.retry_delay = retry_delay
        self.daily = daily
        self.rate_limit = rate_limit
        self.raw = raw

    def friendly(self) -> str:
        if self.daily:
            limit = self.quota_limit or "free-tier"
            return (
                f"Gemini TTS daily free quota khatam ho gaya"
                f" ({self.quota_id or self.reason or 'daily'} limit={limit}). "
                "Free tier par 30-minute Charon narration ek din mein usually poori nahi ban sakti. "
                "Baaki awaaz edge-tts se banegi (zyada flat). "
                "Kal dobara try karo, ya Gemini paid plan use karo."
            )
        if self.rate_limit:
            wait = f" ~{int(self.retry_delay)}s wait" if self.retry_delay else ""
            return f"Gemini TTS rate limit (429){wait}; backoff ke baad retry."
        return str(self)


def _as_dict(obj: Any) -> dict[str, Any]:
    if obj is None:
        return {}
    if isinstance(obj, dict):
        return obj
    if isinstance(obj, (bytes, bytearray)):
        try:
            return json.loads(obj.decode("utf-8", "replace"))
        except Exception:
            return {"message": bytes(obj)[:400].decode("utf-8", "replace")}
    if isinstance(obj, str):
        try:
            val = json.loads(obj)
            if isinstance(val, dict):
                return val
        except Exception:
            pass
        return {"message": obj}
    # httpx.HTTPStatusError, google-genai errors, etc.
    for attr in ("response", "resp"):
        resp = getattr(obj, attr, None)
        if resp is None:
            continue
        # httpx.Response.json() is sync; aiohttp's is a coroutine. Never
        # call an async json() from this sync helper — that leaked
        # "coroutine ClientResponse.json was never awaited" on the laptop.
        try:
            json_fn = getattr(resp, "json", None)
            if callable(json_fn) and not inspect.iscoroutinefunction(json_fn):
                data = json_fn()
                if inspect.isawaitable(data):
                    try:
                        data.close()
                    except Exception:
                        pass
                elif callable(data) and not inspect.iscoroutinefunction(data):
                    data = data()
                    if inspect.isawaitable(data):
                        try:
                            data.close()
                        except Exception:
                            pass
                    elif isinstance(data, dict):
                        return data
                elif isinstance(data, dict):
                    return data
        except Exception:
            pass
        try:
            text = getattr(resp, "text", None)
            if callable(text) and not inspect.iscoroutinefunction(text):
                text = text()
                if inspect.isawaitable(text):
                    try:
                        text.close()
                    except Exception:
                        pass
                    text = None
            if isinstance(text, (bytes, bytearray)):
                return _as_dict(text)
            if isinstance(text, str) and text:
                return _as_dict(text)
        except Exception:
            pass
    # google.genai.errors.ClientError often stringifies to the JSON body.
    return _as_dict(str(obj))


def _retry_delay_from(details: list[Any], blob: str) -> float:
    for d in details:
        if not isinstance(d, dict):
            continue
        raw = d.get("retryDelay") or d.get("retry_delay") or ""
        if raw:
            m = re.match(r"^\s*(\d+(?:\.\d+)?)\s*s", str(raw))
            if m:
                return float(m.group(1))
            try:
                return float(raw)
            except (TypeError, ValueError):
                pass
    m = re.search(r"retry(?:\s+in)?(?:\s+after)?(?:\s+delay)?[^\d]{0,12}(\d+(?:\.\d+)?)\s*s", blob, flags=re.I)
    if m:
        return float(m.group(1))
    return 0.0


def classify_gemini_error(exc: Any, *, default_status: int = 0) -> GeminiTTSError:
    """Parse a Gemini SDK / HTTP error into a quota-aware exception."""
    status = default_status
    if hasattr(exc, "status_code"):
        try:
            status = int(getattr(exc, "status_code") or status)
        except (TypeError, ValueError):
            pass
    if hasattr(exc, "response") and getattr(exc.response, "status_code", None):
        try:
            status = int(exc.response.status_code)
        except (TypeError, ValueError):
            pass

    data = _as_dict(exc)
    # Often wrapped as {"error": {...}}
    err = data.get("error") if isinstance(data.get("error"), dict) else data
    message = str(err.get("message") or data.get("message") or exc)
    if not status:
        try:
            status = int(err.get("code") or 0)
        except (TypeError, ValueError):
            status = 0
    status_text = str(err.get("status") or "")
    details = err.get("details") if isinstance(err.get("details"), list) else []
    blob = message + " " + json.dumps(err, default=str)[:4000]

    quota_id = ""
    quota_metric = ""
    quota_limit = ""
    reason = ""
    for d in details:
        if not isinstance(d, dict):
            continue
        reason = reason or str(d.get("reason") or "")
        meta = d.get("metadata") or d.get("meta") or {}
        if isinstance(meta, dict):
            quota_id = quota_id or str(meta.get("quota_id") or meta.get("quotaId") or "")
            quota_metric = quota_metric or str(
                meta.get("quota_metric") or meta.get("quotaMetric") or ""
            )
            quota_limit = quota_limit or str(
                meta.get("quota_limit") or meta.get("quotaLimit") or meta.get("limit") or ""
            )
        # Some payloads flatten these.
        quota_id = quota_id or str(d.get("quotaId") or d.get("quota_id") or "")
        quota_metric = quota_metric or str(d.get("quotaMetric") or d.get("quota_metric") or "")

    # Also scrape free-form text for quota ids.
    if not quota_id:
        m = re.search(r"(Generate[A-Za-z]+Per(?:Day|Minute|Hour|Second)[A-Za-z0-9_-]*)", blob)
        if m:
            quota_id = m.group(1)
    if not quota_metric:
        m = re.search(r"(generate[_a-z]+(?:free_tier)?[_a-z]*)", blob, flags=re.I)
        if m:
            quota_metric = m.group(1)

    retry_delay = _retry_delay_from(details, blob)
    combined = " ".join([quota_id, quota_metric, reason, status_text, message, blob[:800]]).lower()

    daily = False
    rate_limit = False
    if status == 429 or "resource_exhausted" in combined or "resource exhausted" in combined:
        if any(k in combined for k in ("perday", "per_day", "per-day", "daily", "dayper", "perdayper")):
            daily = True
        elif any(k in combined for k in ("perminute", "per_minute", "per-minute", "persecond", "per_second", "perhour", "per_hour")):
            rate_limit = True
        elif reason.upper() == "RATE_LIMIT_EXCEEDED":
            rate_limit = True
        elif reason.upper() in {"QUOTA_EXCEEDED", "DAILY_QUOTA_EXCEEDED"}:
            daily = True
        elif retry_delay and retry_delay <= 180:
            # A short retryDelay is a rate window, not a midnight reset.
            rate_limit = True
        elif retry_delay and retry_delay >= 1800:
            daily = True
        else:
            # Ambiguous 429 "exceeded your current quota" with no metric.
            # If we already retried with backoff and it still comes back
            # instantly, callers can escalate to daily. Here we mark it as
            # rate_limit first when a retryDelay exists, else "likely daily"
            # when the message talks about plan/billing and has no retry.
            if retry_delay:
                rate_limit = True
            else:
                daily = True

    return GeminiTTSError(
        message,
        status=status or (429 if daily or rate_limit else 0),
        quota_id=quota_id,
        quota_metric=quota_metric,
        quota_limit=quota_limit,
        reason=reason or status_text,
        retry_delay=retry_delay,
        daily=daily,
        rate_limit=rate_limit,
        raw=data,
    )


def is_speechconfig_400(exc: Any) -> bool:
    text = str(exc or "")
    low = text.lower()
    return (
        "speechconfig" in low
        or "speech_config" in low
        or ("invalid_argument" in low and "generation_config" in low)
        or ("unknown name" in low and "speech" in low)
    )


def is_transient(exc: Any) -> bool:
    classified = exc if isinstance(exc, GeminiTTSError) else None
    status = classified.status if classified else 0
    if not status:
        m = re.search(r"\b(429|500|502|503|504)\b", str(exc))
        status = int(m.group(1)) if m else 0
    if classified and classified.daily:
        return False
    return status in {429, 500, 502, 503, 504} or (classified.rate_limit if classified else False)


def backoff_seconds(attempt: int, *, retry_delay: float = 0.0, cap: float = 90.0) -> float:
    """Exponential backoff with jitter. Honor server retryDelay when present."""
    base = retry_delay if retry_delay > 0 else (5 * (2 ** max(0, attempt)))
    base = min(cap, max(2.0, float(base)))
    jitter = base * (0.15 * random.random())
    return min(cap, base + jitter)


def storyteller_prompt(sentence: str, lang: str, *, seconds_hint: Optional[float] = None) -> str:
    lang_l = (lang or "Hindi").lower()
    spoken = "Hindi" if lang_l.startswith("hi") else ("English" if lang_l.startswith("en") else lang)
    pace = (
        "Speak slowly and clearly, with natural dramatic pauses, "
        "in a deep, mature Indian male storyteller voice: rich, cinematic, "
        "emotional, never monotonous, never rushed."
    )
    if seconds_hint and seconds_hint >= 4:
        pace += f" This passage should take about {int(round(seconds_hint))} seconds spoken."
    return (
        "Narrate the text between the <narration> tags and nothing else. "
        f"Language: {spoken}. "
        f"Style: {pace} "
        "Use a quiet whisper-like intensity on eerie lines and a stronger dramatic "
        "delivery on revelations. "
        "Do not stretch individual words, do not translate, do not add words, "
        "do not introduce yourself, do not read the tags.\n"
        f"<narration>\n{(sentence or '').strip()}\n</narration>"
    )


def chunk_text(text: str, *, max_chars: int = MAX_TTS_CHARS, max_words: int = MAX_TTS_WORDS) -> list[str]:
    """Split narration into Gemini-TTS-sized pieces at sentence boundaries."""
    raw = (text or "").replace("\r\n", "\n").strip()
    if not raw:
        return []
    # Reuse the same sentence split idea as voiceover.split_sentences, locally
    # so this module can be tested alone.
    parts = re.split(r"(?<=[।.!?؟…])\s+|\n+", raw)
    sentences = [p.strip() for p in parts if p and p.strip()]
    if not sentences:
        sentences = [raw]
    out: list[str] = []
    buf = ""
    for s in sentences:
        trial = (buf + " " + s).strip() if buf else s
        words = len(trial.split())
        if buf and (len(trial) > max_chars or words > max_words):
            out.append(buf)
            # If a single sentence is itself huge, hard-wrap on commas / spaces.
            if len(s) > max_chars or len(s.split()) > max_words:
                out.extend(_hard_wrap(s, max_chars, max_words))
                buf = ""
            else:
                buf = s
        else:
            buf = trial
    if buf:
        if len(buf) > max_chars or len(buf.split()) > max_words:
            out.extend(_hard_wrap(buf, max_chars, max_words))
        else:
            out.append(buf)
    return [c for c in out if c]


def _hard_wrap(text: str, max_chars: int, max_words: int) -> list[str]:
    bits = re.split(r"(?<=[,;:，、])\s+", text)
    if len(bits) == 1:
        bits = text.split()
        packed, buf, wc = [], [], 0
        for w in bits:
            if buf and (len(" ".join(buf)) + len(w) + 1 > max_chars or wc + 1 > max_words):
                packed.append(" ".join(buf))
                buf, wc = [w], 1
            else:
                buf.append(w)
                wc += 1
        if buf:
            packed.append(" ".join(buf))
        return packed
    out, buf = [], ""
    for b in bits:
        trial = (buf + " " + b).strip() if buf else b
        if buf and (len(trial) > max_chars or len(trial.split()) > max_words):
            out.append(buf)
            buf = b
        else:
            buf = trial
    if buf:
        out.append(buf)
    return out


def expand_segments(
    segments: list[dict[str, Any]],
    *,
    max_chars: int = MAX_TTS_CHARS,
    max_words: int = MAX_TTS_WORDS,
) -> list[dict[str, Any]]:
    """Split oversized planner segments; keep min_sec only on the last piece."""
    out: list[dict[str, Any]] = []
    for seg in segments or []:
        text = str(seg.get("text") or seg.get("narration") or "").strip()
        if not text:
            continue
        try:
            min_sec = float(seg.get("min_sec") or seg.get("duration_sec") or 0)
        except (TypeError, ValueError):
            min_sec = 0.0
        parts = chunk_text(text, max_chars=max_chars, max_words=max_words) or [text]
        if len(parts) == 1:
            out.append({"text": parts[0], "min_sec": max(0.0, min_sec)})
            continue
        # Spread a minimum duration across the pieces.
        share = (min_sec / len(parts)) if min_sec else 0.0
        for i, p in enumerate(parts):
            out.append({"text": p, "min_sec": share if i < len(parts) - 1 else share})
    return out


def _decode_inline(data: Any) -> bytes:
    if data is None:
        return b""
    if isinstance(data, bytes):
        return data
    if isinstance(data, (bytearray, memoryview)):
        return bytes(data)
    if isinstance(data, str):
        try:
            return base64.b64decode(data)
        except Exception:
            return b""
    return b""


def extract_audio_from_response(data: dict[str, Any]) -> tuple[bytes, str]:
    cands = data.get("candidates") or []
    if not cands:
        raise GeminiTTSError("Gemini TTS returned no candidates", status=0)
    parts = ((cands[0].get("content") or {}).get("parts") or [])
    for part in parts:
        if not isinstance(part, dict):
            continue
        inline = part.get("inlineData") or part.get("inline_data") or {}
        if not isinstance(inline, dict):
            continue
        raw = _decode_inline(inline.get("data"))
        mime = str(inline.get("mimeType") or inline.get("mime_type") or "")
        if raw:
            return raw, mime
    raise GeminiTTSError("Gemini TTS returned empty audio", status=0)


def speechconfig_bodies(prompt: str, voice: str, lang: str) -> list[dict[str, Any]]:
    """Payload shapes, most official first. languageCode is optional on some models."""
    lang_code = "hi-IN" if (lang or "").lower().startswith("hi") else "en-US"
    voice_cfg = {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}}
    voice_snake = {"voice_config": {"prebuilt_voice_config": {"voice_name": voice}}}
    contents = [{"role": "user", "parts": [{"text": prompt}]}]
    return [
        {
            "contents": contents,
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {**voice_cfg, "languageCode": lang_code},
            },
        },
        {
            "contents": contents,
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": voice_cfg,
            },
        },
        {
            "contents": contents,
            "generationConfig": {"responseModalities": ["AUDIO"]},
            "speechConfig": {**voice_cfg, "languageCode": lang_code},
        },
        {
            "contents": contents,
            "generationConfig": {
                "response_modalities": ["AUDIO"],
                "speech_config": {**voice_snake},
            },
        },
    ]


def _raise_http_error(resp: httpx.Response) -> None:
    try:
        data = resp.json()
    except Exception:
        data = {"error": {"code": resp.status_code, "message": resp.text[:800]}}
    wrapped = json.dumps(data, default=str)
    # Use a dummy exception that classify can parse.
    class _E(Exception):
        pass
    err = _E(wrapped)
    err.response = resp  # type: ignore[attr-defined]
    err.status_code = resp.status_code  # type: ignore[attr-defined]
    classified = classify_gemini_error(err, default_status=resp.status_code)
    raise classified


async def gemini_tts_rest(
    text: str,
    *,
    lang: str,
    model: str,
    voice: str,
    api_key: str,
    timeout: float = 90.0,
    seconds_hint: Optional[float] = None,
) -> tuple[bytes, str]:
    if not api_key:
        raise GeminiTTSError("GEMINI_API_KEY is not set")
    prompt = storyteller_prompt(text, lang, seconds_hint=seconds_hint)
    url = GEMINI_GENERATE_URL.format(model=model)
    headers = {"x-goog-api-key": api_key, "Content-Type": "application/json"}
    last: Optional[Exception] = None
    tried_400 = False
    async with httpx.AsyncClient(timeout=timeout) as client:
        for i, body in enumerate(speechconfig_bodies(prompt, voice, lang)):
            try:
                resp = await client.post(url, headers=headers, json=body)
            except httpx.HTTPError as exc:
                last = exc
                logger.warning("Gemini TTS REST network error (%s): %s", model, exc)
                continue
            if resp.status_code == 400 and (
                is_speechconfig_400(resp.text) or i < len(speechconfig_bodies(prompt, voice, lang)) - 1
            ):
                last = GeminiTTSError(resp.text[:400], status=400)
                tried_400 = True
                logger.info("Gemini TTS REST payload %s rejected (400); trying next shape", i + 1)
                continue
            if resp.status_code >= 400:
                _raise_http_error(resp)
            data = resp.json()
            return extract_audio_from_response(data)
    if last:
        raise last
    raise GeminiTTSError("Gemini TTS REST failed with no response")


async def gemini_tts_sdk(
    text: str,
    *,
    lang: str,
    model: str,
    voice: str,
    api_key: str,
    seconds_hint: Optional[float] = None,
) -> tuple[bytes, str]:
    from google import genai
    from google.genai import types

    if not api_key:
        raise GeminiTTSError("GEMINI_API_KEY is not set")
    client = genai.Client(api_key=api_key)
    speech_kwargs: dict[str, Any] = {
        "voice_config": types.VoiceConfig(
            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice)
        )
    }
    try:
        lang_code = "hi-IN" if (lang or "").lower().startswith("hi") else "en-US"
        speech = types.SpeechConfig(**speech_kwargs, language_code=lang_code)
    except (TypeError, ValueError):
        speech = types.SpeechConfig(**speech_kwargs)

    prompt = storyteller_prompt(text, lang, seconds_hint=seconds_hint)
    try:
        response = await client.aio.models.generate_content(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=speech,
            ),
        )
    except Exception as exc:
        raise classify_gemini_error(exc) from exc

    data = b""
    mime = ""
    try:
        parts = response.candidates[0].content.parts
    except Exception as exc:
        raise GeminiTTSError(f"Gemini TTS returned no audio: {exc}") from exc
    for part in parts or []:
        inline = getattr(part, "inline_data", None) or getattr(part, "inlineData", None)
        if inline is None:
            continue
        data = _decode_inline(getattr(inline, "data", None))
        mime = str(getattr(inline, "mime_type", None) or getattr(inline, "mimeType", None) or "")
        if data:
            break
    if not data:
        raise GeminiTTSError("Gemini TTS returned empty audio")
    return data, mime


async def gemini_tts_one(
    text: str,
    *,
    lang: str,
    model: str,
    voice: str,
    api_key: str,
    seconds_hint: Optional[float] = None,
    prefer_rest: bool = False,
) -> tuple[bytes, str, str]:
    """Return (audio_bytes, mime, path_used) where path_used is 'sdk' or 'rest'.

    SDK first (unless prefer_rest). On speechConfig 400 or other non-quota
    failures, fall through to REST with several JSON shapes.
    """
    errors: list[str] = []
    order = ("rest", "sdk") if prefer_rest else ("sdk", "rest")
    for path in order:
        try:
            if path == "sdk":
                data, mime = await gemini_tts_sdk(
                    text, lang=lang, model=model, voice=voice, api_key=api_key,
                    seconds_hint=seconds_hint,
                )
            else:
                data, mime = await gemini_tts_rest(
                    text, lang=lang, model=model, voice=voice, api_key=api_key,
                    seconds_hint=seconds_hint,
                )
            return data, mime, path
        except GeminiTTSError as exc:
            if exc.daily or exc.rate_limit:
                raise
            errors.append(f"{path}: {exc}")
            if path == "sdk" and (is_speechconfig_400(exc) or exc.status in {0, 400}):
                logger.warning("Gemini TTS SDK failed (%s); trying REST", exc)
                continue
            if path == "sdk":
                logger.warning("Gemini TTS SDK failed (%s); trying REST", exc)
                continue
            raise
        except Exception as exc:
            classified = classify_gemini_error(exc)
            if classified.daily or classified.rate_limit:
                raise classified from exc
            errors.append(f"{path}: {exc}")
            if path == "sdk":
                if is_speechconfig_400(exc):
                    logger.warning(
                        "Gemini TTS SDK speechConfig 400 (likely an old google-genai); trying REST"
                    )
                else:
                    logger.warning("Gemini TTS SDK failed (%s); trying REST", exc)
                continue
            raise classified from exc
    raise GeminiTTSError("; ".join(errors) or "Gemini TTS failed")
