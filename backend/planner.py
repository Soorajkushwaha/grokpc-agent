"""Story + prompt planning.

Phase 1: ChatGPT web (logged-in Chrome profile, one-time login via noVNC),
then Google's free Gemini text API, then DeepSeek as last paid fallback.
DRY_RUN returns a deterministic mock plan so the rest of the pipeline can
be tested without network or a browser.
"""
from __future__ import annotations

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
    FEATURE_CHATGPT_PLANNER,
    GEMINI_API_KEY,
    GEMINI_TEXT_MODEL,
    PLANNER,
)
from db import record_usage
from style_profile import load_profile, planner_brief
from vision_loop import _extract_json

logger = logging.getLogger("grokpc.planner")

LogFn = Callable[[dict[str, Any]], Awaitable[None]]

PLAN_SCHEMA_HINT = """
Return ONLY one JSON object (no markdown) with this exact shape:
{
  "title": "video title in the channel language",
  "hook": "first 3-second hook line",
  "story": "short paragraph of the full story",
  "scenes": [
    {
      "id": 1,
      "narration": "what the voice says in this scene (channel language, 1-2 slow sentences, ~8 seconds spoken)",
      "visual": "what we see",
      "image_prompt": "detailed English still-image prompt, same setting across scenes, no text in the image",
      "video_prompt": "detailed video/motion prompt",
      "duration_sec": 8
    }
  ],
  "voiceover_script": "full voiceover, ready to be read aloud, in the channel language, slow horror-storyteller pace",
  "thumbnail_prompt": "thumbnail image prompt",
  "tags": ["tag1", "tag2"],
  "description": "YouTube description, 2-4 short paragraphs, with a CTA"
}
Use 6 to 10 scenes; prefer exactly 8 scenes of about 8 seconds each (~64 seconds total) unless the user asks otherwise.
Every image_prompt must be English, photorealistic, cinematic, and consistent: same haunted Indian haveli, same night (until a final dawn if the story calls for it), same architecture. Do not put text, watermarks, logos, or letters in the image.
Safety: fear comes only from atmosphere (fog, moonlight, shadow, a distant animal). No people, no faces, no children, no blood, no gore, no weapons.
Each scene narration should be speakable slowly in about 8 seconds. duration_sec should be 8 unless a scene genuinely needs more.
"""


def mock_plan(topic: str, channel: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    lang = (channel or {}).get("language") or "Hindi"
    title = topic.strip() or "Nayi video"
    script = (
        f"Namaste dosto! Aaj hum baat karenge: {title}. "
        "Pehle simple idea, phir teen clear steps, aur last me aap khud try kar sakte ho. "
        "Video pasand aaye to like aur subscribe kar dena."
    )
    scenes = [
        {
            "id": 1,
            "narration": f"Namaste dosto! Aaj ka topic: {title}.",
            "visual": "Warm intro title card, creator-style, clean background",
            "image_prompt": f"Cinematic intro still about {title}, bright, Indian YouTube thumbnail energy, 16:9",
            "video_prompt": f"Slow push-in on a title card about {title}, warm light",
            "duration_sec": 6,
        },
        {
            "id": 2,
            "narration": "Pehle problem samajhte hain, seedhi bhasha me.",
            "visual": "Simple problem visual, one subject, no clutter",
            "image_prompt": f"Clear illustration of the problem behind {title}, educational, 16:9",
            "video_prompt": f"Gentle motion over a problem illustration for {title}",
            "duration_sec": 8,
        },
        {
            "id": 3,
            "narration": "Ab solution, ek-ek karke.",
            "visual": "Three-step graphic",
            "image_prompt": f"Three clean steps solving {title}, infographic, 16:9",
            "video_prompt": f"Steps appearing one by one about {title}",
            "duration_sec": 10,
        },
        {
            "id": 4,
            "narration": "Bas itna yaad rakho, aur try karo. Like aur subscribe kar dena.",
            "visual": "Outro with thanks and subscribe reminder",
            "image_prompt": f"Friendly outro still for a Hindi YouTube video on {title}",
            "video_prompt": "Soft zoom on outro, subscribe pulse",
            "duration_sec": 6,
        },
    ]
    return {
        "title": title[:80],
        "hook": f"Ruko — {title} aap soch se simple hai.",
        "story": f"Ek short video jo '{title}' ko {lang} me clearly explain karti hai.",
        "scenes": scenes,
        "voiceover_script": script,
        "thumbnail_prompt": f"Bold Hindi YouTube thumbnail about {title}, expressive face or clear object, high contrast, readable text",
        "tags": [w for w in re.split(r"\W+", title) if w][:8] or ["hindi", "youtube"],
        "description": f"{title}\n\nIs video me simple language me samjhaaya gaya hai.\n\nLike, share, subscribe.",
    }



def themed_fallback_plan(topic: str, channel: Optional[dict[str, Any]] = None) -> Optional[dict[str, Any]]:
    """A carefully written 8-scene plan for the haunted-haveli + bear story.

    Used only when live planners fail, so a known topic still gets on-theme
    visuals instead of the generic educational mock.
    """
    blob = f"{topic or ''}".lower()
    if not any(k in blob for k in ("हवेली", "haveli", "haveli")):
        return None
    if not any(k in blob for k in ("भालू", "bhaalu", "bhalu", "bear")):
        return None
    lang = (channel or {}).get("language") or "Hindi"
    scenes = [
        {
            "id": 1,
            "narration": "आधी रात है। बंद हवेली का आँगन सुनसान पड़ा है, चाँद की ठंडी रोशनी टूटी दीवारों पर गिर रही है।",
            "visual": "Abandoned Indian haveli courtyard at midnight, cold moonlight, one unlit diya on a stone ledge.",
            "image_prompt": "Abandoned old Indian haveli at midnight, empty courtyard, cold blue moonlight on carved sandstone pillars, a single unlit clay oil lamp (diya) on a stone ledge, thick quiet, photorealistic cinematic wide shot",
            "video_prompt": "Slow dolly-in through an empty moonlit haveli courtyard toward an unlit diya",
            "duration_sec": 8,
        },
        {
            "id": 2,
            "narration": "पत्थर की सीढ़ी पर रखा दीया अचानक अपने आप जल उठता है, और उसकी छोटी लौ में परछाइयाँ काँपने लगती हैं।",
            "visual": "The diya lights by itself; a small warm flame flickers, shadows stretch on carved pillars.",
            "image_prompt": "Close cinematic shot of a clay diya on a carved stone ledge inside an Indian haveli, flame just coming to life by itself, warm orange glow against cold moonlight, long shadows on pillars, no people",
            "video_prompt": "The unlit diya catches flame by itself, warm light spreading over stone",
            "duration_sec": 8,
        },
        {
            "id": 3,
            "narration": "कोहरा घना होता जा रहा है, टूटे दरवाज़े और मेहराब धीरे-धीरे धुंध में डूब रहे हैं।",
            "visual": "Fog thickens and rolls through the broken courtyard, swallowing steps and arches.",
            "image_prompt": "Thick volumetric fog rolling through a broken Indian haveli courtyard at night, swallowing stone steps and arches, a distant small diya glow barely visible, moonlight beams in the mist, photorealistic",
            "video_prompt": "Fog pouring through the courtyard, swallowing arches",
            "duration_sec": 8,
        },
        {
            "id": 4,
            "narration": "कोहरे के पर्दे से एक विशाल काला भालू धीरे-धीरे निकलता है, फाटक पर उसकी भारी परछाई रुक जाती है।",
            "visual": "A huge black bear slowly emerges from the fog at the gate, massive silhouette, no attack.",
            "image_prompt": "A huge black sloth bear emerging slowly from thick fog at the carved wooden gate of an old Indian haveli at midnight, massive silhouette, no attack, photorealistic wildlife, cinematic low angle, moonlight rim light, no people",
            "video_prompt": "A huge black bear stepping out of fog at the haveli gate",
            "duration_sec": 8,
        },
        {
            "id": 5,
            "narration": "भालू की साँस दीये तक पहुँचती है, और लौ डर के मारे काँपने लगती है।",
            "visual": "The bear's breath reaches the lamp; the diya flame trembles and bends.",
            "image_prompt": "Close-up of a trembling clay diya flame bending sideways as if from a large animal's breath, faint fog swirling, dark haveli stone background, a huge blurred bear shape in the deep background, cinematic shallow depth of field",
            "video_prompt": "Diya flame trembling as a breath of fog rolls past",
            "duration_sec": 8,
        },
        {
            "id": 6,
            "narration": "वह अपने पिछले पैरों पर खड़ा हो जाता है, और पूरे चाँद के सामने उसकी विशाल काली आकृति छा जाती है।",
            "visual": "The bear stands on hind legs, silhouetted against the full moon above the haveli roof.",
            "image_prompt": "Huge black bear standing on hind legs on a haveli rooftop terrace, silhouetted against a full moon, Indian carved parapet, midnight sky with thin clouds, dramatic rim light, photorealistic cinematic, no people",
            "video_prompt": "Bear rearing up, silhouetted against the full moon",
            "duration_sec": 8,
        },
        {
            "id": 7,
            "narration": "दीया बुझ जाता है। अँधेरे में केवल दो चमकती आँखें रह जाती हैं, और वे भी कोहरे में धीरे-धीरे गायब हो जाती हैं।",
            "visual": "The diya goes out. In the dark, two glowing animal eyes fade back into the fog.",
            "image_prompt": "Pitch-dark Indian haveli courtyard after the lamp has gone out, only two faint glowing animal eyes fading into thick fog, no body clearly visible, moonlight almost gone, eerie photorealistic atmosphere, no people",
            "video_prompt": "The diya extinguishes, two glowing eyes fade into fog",
            "duration_sec": 8,
        },
        {
            "id": 8,
            "narration": "सुबह हो चुकी है। आँगन फिर से खाली है, और वही दीया एक बार फिर शांत लौ के साथ जल रहा है।",
            "visual": "Dawn. Empty courtyard. The same diya burns again in gentle morning light and leftover mist.",
            "image_prompt": "Dawn over an empty Indian haveli courtyard, soft golden morning light, leftover thin mist, the same clay diya burning gently on the stone ledge, peaceful after the night, photorealistic cinematic wide shot, no people, no bear",
            "video_prompt": "Gentle dawn, empty courtyard, the diya burning quietly again",
            "duration_sec": 8,
        },
    ]
    script = " ".join(s["narration"] for s in scenes)
    return {
        "title": (topic.strip() or "आधी रात की हवेली")[:80],
        "hook": "आधी रात है, और बंद हवेली में एक दीया अपने आप जल उठता है।",
        "story": (
            "आधी रात एक बंद भारतीय हवेली के सुनसान आँगन में दीया अपने आप जलता है, "
            "कोहरा घना होता है, और कोहरे से एक विशाल काला भालू निकलता है। "
            "डर महौल से आता है, खून या हथियार से नहीं। सुबह आँगन खाली होता है "
            "और वही दीया फिर जल रहा होता है।"
        ),
        "scenes": scenes,
        "voiceover_script": script,
        "thumbnail_prompt": (
            "Cinematic thumbnail: huge black bear silhouette against a full moon "
            "above an Indian haveli, a small diya glowing in the foreground fog, "
            "no text, photorealistic, dark horror mood"
        ),
        "tags": ["हवेली", "भालू", "हॉरर", "आधी रात", "दीया", "कोहरा"],
        "description": f"{topic.strip()}\n\nएक छोटी हॉरर कहानी — डर महौल से, खून से नहीं।",
        "language": lang,
    }


def normalize_plan(raw: dict[str, Any], topic: str) -> dict[str, Any]:
    base = mock_plan(topic)
    if not isinstance(raw, dict):
        return base
    out = dict(base)
    for key in ("title", "hook", "story", "voiceover_script", "thumbnail_prompt", "description"):
        val = raw.get(key)
        if isinstance(val, str) and val.strip():
            out[key] = val.strip()
    tags = raw.get("tags")
    if isinstance(tags, list):
        out["tags"] = [str(t)[:40] for t in tags if str(t).strip()][:20]
    scenes = raw.get("scenes")
    if isinstance(scenes, list) and scenes:
        clean = []
        for i, s in enumerate(scenes, 1):
            if not isinstance(s, dict):
                continue
            clean.append(
                {
                    "id": int(s.get("id") or i),
                    "narration": str(s.get("narration") or "").strip(),
                    "visual": str(s.get("visual") or "").strip(),
                    "image_prompt": str(s.get("image_prompt") or s.get("visual") or "").strip(),
                    "video_prompt": str(s.get("video_prompt") or "").strip(),
                    "duration_sec": int(s.get("duration_sec") or 8),
                }
            )
        if clean:
            out["scenes"] = clean
    if not (out.get("voiceover_script") or "").strip():
        parts = [s.get("narration") for s in out["scenes"] if s.get("narration")]
        out["voiceover_script"] = " ".join(parts) or base["voiceover_script"]
    return out


def build_prompt(topic: str, idea: str, channel: Optional[dict[str, Any]], profile: Optional[dict[str, Any]] = None) -> str:
    brief = planner_brief(profile or load_profile(), channel)
    extra = f"\nExtra idea / notes from the creator: {idea.strip()}\n" if (idea or "").strip() else ""
    return (
        "You are planning a YouTube video for this creator. Think the way they think.\n\n"
        f"{brief}\n\n"
        f"Topic: {topic.strip()}\n"
        f"{extra}\n"
        f"{PLAN_SCHEMA_HINT}\n"
        "Fill every field. The voiceover_script must be speakable as-is."
    )


async def plan_with_deepseek(prompt: str) -> tuple[dict[str, Any], dict[str, Any]]:
    if not DEEPSEEK_API_KEY:
        raise RuntimeError("DEEPSEEK_API_KEY is not set")
    body = {
        "model": DEEPSEEK_MODEL,
        "temperature": 0.6,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a YouTube video planner. Reply with one JSON object only, "
                    "no markdown fences, no extra text."
                ),
            },
            {"role": "user", "content": prompt},
        ],
    }
    async with httpx.AsyncClient(timeout=90.0) as client:
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
    usage = data.get("usage") or {}
    tokens_in = int(usage.get("prompt_tokens") or 0)
    tokens_out = int(usage.get("completion_tokens") or 0)
    record_usage(
        task_type="plan",
        status="ok",
        details="deepseek-text",
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        provider="deepseek",
        model=data.get("model") or DEEPSEEK_MODEL,
    )
    plan = _extract_json(content)
    meta = {
        "provider": "deepseek",
        "model": data.get("model") or DEEPSEEK_MODEL,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
    }
    return plan, meta


GEMINI_GENERATE_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
)


def _gemini_text(data: dict[str, Any]) -> str:
    cands = data.get("candidates") or []
    if not cands:
        raise RuntimeError("Gemini returned no candidates")
    parts = ((cands[0].get("content") or {}).get("parts") or [])
    texts = [p.get("text", "") for p in parts if isinstance(p, dict) and p.get("text")]
    if not texts:
        raise RuntimeError("Gemini returned empty content")
    return "\n".join(texts)


async def plan_with_gemini(prompt: str) -> tuple[dict[str, Any], dict[str, Any]]:
    """Plan a video with the free-tier Gemini generateContent API."""
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not set")
    body = {
        "systemInstruction": {
            "parts": [
                {
                    "text": (
                        "You are a YouTube video planner. Reply with one JSON object only, "
                        "no markdown fences, no extra text."
                    )
                }
            ]
        },
        "contents": [
            {
                "role": "user",
                "parts": [{"text": prompt}],
            }
        ],
        "generationConfig": {
            "temperature": 0.6,
            "responseMimeType": "application/json",
        },
    }
    url = GEMINI_GENERATE_URL.format(model=GEMINI_TEXT_MODEL)
    async with httpx.AsyncClient(timeout=90.0) as client:
        resp = await client.post(
            url,
            headers={
                "x-goog-api-key": GEMINI_API_KEY,
                "Content-Type": "application/json",
            },
            json=body,
        )
        resp.raise_for_status()
        data = resp.json()
    content = _gemini_text(data)
    usage = data.get("usageMetadata") or {}
    tokens_in = int(usage.get("promptTokenCount") or 0)
    tokens_out = int(usage.get("candidatesTokenCount") or 0)
    rec = record_usage(
        task_type="plan",
        status="ok",
        details="gemini-text",
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        provider="gemini",
        model=GEMINI_TEXT_MODEL,
        cost_usd=0.0,  # free-tier planning is logged as INR 0
    )
    plan = _extract_json(content)
    meta = {
        "provider": "gemini",
        "model": GEMINI_TEXT_MODEL,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "cost_inr": rec.get("cost_inr", 0) or 0,
    }
    return plan, meta


async def plan_with_chatgpt_web(
    prompt: str,
    *,
    agent: Any,
    log: Optional[LogFn] = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Best-effort: open chatgpt.com, paste the prompt, read JSON from the 'done' text.

    This is untested against the live ChatGPT DOM (sites change). Failures
    should fall back to Gemini, then DeepSeek. Login walls return auth_required.
    """
    if agent is None:
        raise RuntimeError("No browser agent available for ChatGPT planning")
    task = (
        "Go to https://chatgpt.com (or https://chat.openai.com if that redirects). "
        "If you see a login / sign-in wall, STOP and use action done with text "
        "AUTH_REQUIRED: ChatGPT login needed in noVNC. "
        "If a chat box is available: start a new chat if you can, click the message box, "
        "type the following planning prompt EXACTLY, then press Enter. "
        "Wait until the assistant finishes (no 'stop generating' / spinning). "
        "Then use action done, and put the assistant's FULL reply (the JSON object) in the "
        "'text' field. If the reply has markdown fences, still include the JSON.\n\n"
        "-----PROMPT START-----\n"
        f"{prompt}\n"
        "-----PROMPT END-----"
    )
    result = await agent.run_generic_task(task)
    text = str(result.get("result") or "")
    if "AUTH_REQUIRED" in text.upper() or (result.get("status") == "auth_required"):
        raise ChatGPTAuthRequired(text or "ChatGPT login needed")
    try:
        plan = _extract_json(text)
    except Exception:
        # Last try: maybe the model put JSON in a step thought.
        blob = text
        for step in result.get("steps") or []:
            action = (step or {}).get("action") or {}
            blob += "\n" + str(action.get("text") or "")
        plan = _extract_json(blob)
    return plan, {"provider": "chatgpt-web", "model": "chatgpt", "tokens_in": 0, "tokens_out": 0, "raw_status": result.get("status")}


class ChatGPTAuthRequired(RuntimeError):
    pass


async def plan_story(
    topic: str,
    idea: str = "",
    channel: Optional[dict[str, Any]] = None,
    *,
    agent: Any = None,
    log: Optional[LogFn] = None,
    dry_run: Optional[bool] = None,
) -> dict[str, Any]:
    topic = (topic or "").strip() or "Nayi video"
    use_dry = DRY_RUN if dry_run is None else dry_run
    prompt = build_prompt(topic, idea, channel)

    async def _emit(title: str, message: str) -> None:
        logger.info("%s: %s", title, message)
        if log:
            await log({"type": "action", "title": title, "message": message})

    if use_dry:
        await _emit("Planner", "DRY_RUN mock plan")
        return {
            "status": "ok",
            "planner": "mock",
            "plan": mock_plan(topic, channel),
            "note": "DRY_RUN",
        }

    errors: list[str] = []
    # Explicit PLANNER=gemini or PLANNER=deepseek skips earlier providers.
    # Default / PLANNER=chatgpt: ChatGPT web -> Gemini (free) -> DeepSeek.
    prefer_chatgpt = FEATURE_CHATGPT_PLANNER and PLANNER not in {"deepseek", "gemini"}
    prefer_gemini = bool(GEMINI_API_KEY) and PLANNER != "deepseek"

    if prefer_chatgpt and agent is not None:
        try:
            await _emit("Planner", "ChatGPT web se plan maang raha hoon")
            raw, meta = await plan_with_chatgpt_web(prompt, agent=agent, log=log)
            plan = normalize_plan(raw, topic)
            await _emit("Planner", f"ChatGPT se plan mil gaya: {plan.get('title')}")
            return {"status": "ok", "planner": "chatgpt", "plan": plan, "meta": meta}
        except ChatGPTAuthRequired as exc:
            errors.append(f"chatgpt_auth: {exc}")
            await _emit("Planner", "ChatGPT login nahi mila — Gemini fallback")
        except Exception as exc:
            errors.append(f"chatgpt: {exc}")
            logger.warning("ChatGPT planning failed: %s", exc)
            await _emit("Planner", f"ChatGPT fail ({exc}); Gemini try kar raha hoon")

    if prefer_gemini:
        try:
            await _emit("Planner", f"Gemini free API se plan ({GEMINI_TEXT_MODEL})")
            raw, meta = await plan_with_gemini(prompt)
            plan = normalize_plan(raw, topic)
            await _emit("Planner", f"Gemini se plan mil gaya: {plan.get('title')}")
            status = "fallback" if errors else "ok"
            return {
                "status": status,
                "planner": "gemini",
                "plan": plan,
                "meta": meta,
                "note": "; ".join(errors) if errors else "",
            }
        except Exception as exc:
            errors.append(f"gemini: {exc}")
            logger.warning("Gemini planning failed: %s", exc)
            await _emit("Planner", f"Gemini fail ({exc}); DeepSeek try kar raha hoon")

    if DEEPSEEK_API_KEY:
        try:
            await _emit("Planner", "DeepSeek text API se plan")
            raw, meta = await plan_with_deepseek(prompt)
            plan = normalize_plan(raw, topic)
            await _emit("Planner", f"DeepSeek se plan mil gaya: {plan.get('title')}")
            status = "fallback" if errors else "ok"
            return {
                "status": status,
                "planner": "deepseek",
                "plan": plan,
                "meta": meta,
                "note": "; ".join(errors) if errors else "",
            }
        except Exception as exc:
            errors.append(f"deepseek: {exc}")
            logger.warning("DeepSeek planning failed: %s", exc)

    # Last resort so the pipeline can still produce a draft video offline.
    await _emit("Planner", "API nahi chali, local draft plan use kar raha hoon")
    plan = themed_fallback_plan(topic, channel) or mock_plan(topic, channel)
    return {
        "status": "fallback",
        "planner": "fallback",
        "plan": plan,
        "note": "; ".join(errors) or "no planner available",
    }
