"""Per-user style profile used when asking ChatGPT / DeepSeek to plan a video."""
from __future__ import annotations

import json
from typing import Any

from config import style_profile_path

# Editable default for Sooraj. Keep this generic and honest — he can refine it
# in the Settings screen. Never put secrets here.
DEFAULT_PROFILE = {
    "name": "Sooraj Kushwaha",
    "language": "Hindi",
    "spoken_mix": "Hinglish",
    "tone": "Seedha, practical, dost-jaise. Hook pehle, fluff nahi. Indian audience.",
    "thinking_style": (
        "Pehle socho: is video ka hook 3 second me kyun rukega? Phir poori story "
        "ek simple line me. Phir scenes — har scene me kya dikhega aur kya bola "
        "jayega. Prompts concrete aur visual hon. Budget aur time ka khayal rakho: "
        "kam shots, clear visuals, strong voiceover. Closing me subscribe/CTA natural ho."
    ),
    "voiceover_notes": (
        "Natural bolchaal Hindi/Hinglish, zyada formal ya news-anchor mat bano. "
        "Short sentences. Numbers aur naam clearly bolo."
    ),
    "visual_notes": (
        "Clear, bright, mobile pe padhne layak text. Face ya strong subject center me. "
        "Avoid cluttered text walls."
    ),
    "audience": "India, YouTube, Hindi-speaking, mixed age",
    "avoid": "Clickbait jhooth, political fights, copyrighted music/footage, English-only formal tone",
}


def load_profile() -> dict[str, Any]:
    path = style_profile_path()
    if not path.is_file():
        save_profile(DEFAULT_PROFILE)
        return dict(DEFAULT_PROFILE)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return dict(DEFAULT_PROFILE)
    if not isinstance(data, dict):
        return dict(DEFAULT_PROFILE)
    merged = dict(DEFAULT_PROFILE)
    for k, v in data.items():
        if v is not None:
            merged[k] = v
    return merged


def save_profile(payload: dict[str, Any]) -> dict[str, Any]:
    current = dict(DEFAULT_PROFILE)
    if style_profile_path().is_file():
        try:
            current.update(json.loads(style_profile_path().read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            pass
    for k, v in payload.items():
        if k in DEFAULT_PROFILE or k in current:
            current[k] = v
        elif isinstance(v, (str, int, float, bool, list, dict)):
            current[k] = v
    path = style_profile_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(current, indent=2, ensure_ascii=False), encoding="utf-8")
    return current


def planner_brief(profile: dict[str, Any] | None = None, channel: dict[str, Any] | None = None) -> str:
    p = profile or load_profile()
    lines = [
        f"Creator: {p.get('name') or 'Sooraj'}",
        f"Language: {p.get('language') or 'Hindi'} (spoken mix: {p.get('spoken_mix') or 'Hinglish'})",
        f"Tone: {p.get('tone') or ''}",
        f"How they think / plan: {p.get('thinking_style') or ''}",
        f"Voiceover: {p.get('voiceover_notes') or ''}",
        f"Visuals: {p.get('visual_notes') or ''}",
        f"Audience: {p.get('audience') or ''}",
        f"Avoid: {p.get('avoid') or ''}",
    ]
    if channel:
        lines.append(
            f"This video is for YouTube channel '{channel.get('name')}' "
            f"(niche: {channel.get('niche') or 'general'}, "
            f"language: {channel.get('language') or p.get('language')}, "
            f"style: {channel.get('style') or ''}, "
            f"aspect: {channel.get('aspect') or '16:9'})."
        )
    return "\n".join(lines)
