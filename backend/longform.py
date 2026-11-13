"""Chapter-by-chapter story planning for long videos (3–30 minutes)."""
from __future__ import annotations

import logging
import re
from typing import Any, Awaitable, Callable, Optional

from duration_target import (
    DurationTarget,
    MAX_SCENES,
    chapter_scene_share,
    chapter_word_share,
    plan_schema_hint,
    word_count,
)
from style_profile import load_profile, planner_brief

logger = logging.getLogger("grokpc.longform")

def _clean_raw(raw: dict[str, Any], topic: str) -> dict[str, Any]:
    """Shape a chapter JSON without filling in the short-form mock plan."""
    if not isinstance(raw, dict):
        raw = {}
    scenes = []
    for i, s in enumerate(raw.get("scenes") or [], 1):
        if not isinstance(s, dict):
            continue
        try:
            dur = int(s.get("duration_sec") or 0)
        except (TypeError, ValueError):
            dur = 0
        narr = str(s.get("narration") or "").strip()
        visual = str(s.get("visual") or "").strip()
        img = str(s.get("image_prompt") or visual or "").strip()
        if not (narr or img or visual):
            continue
        scenes.append({
            "id": int(s.get("id") or i),
            "narration": narr,
            "visual": visual,
            "image_prompt": img,
            "video_prompt": str(s.get("video_prompt") or "").strip(),
            "duration_sec": dur or 0,
            "chapter": s.get("chapter"),
        })
    vo = str(raw.get("voiceover_script") or "").strip()
    if not vo:
        vo = " ".join(s["narration"] for s in scenes if s["narration"]).strip()
    return {
        "title": str(raw.get("title") or "").strip(),
        "hook": str(raw.get("hook") or "").strip(),
        "story": str(raw.get("story") or "").strip(),
        "scenes": scenes,
        "voiceover_script": vo,
        "thumbnail_prompt": str(raw.get("thumbnail_prompt") or "").strip(),
        "tags": [str(x) for x in (raw.get("tags") or []) if str(x).strip()][:20],
        "description": str(raw.get("description") or "").strip(),
    }



LogFn = Callable[[dict[str, Any]], Awaitable[None]]


def extract_chapter_headings(blob: str) -> list[dict[str, Any]]:
    """Pull 'CHAPTER 1 – title' headings and the body that follows each."""
    text = blob or ""
    # Keep a copy for slicing; match on a unified pattern.
    pattern = re.compile(
        r"(?:^|\n)\s*(?:CHAPTER|Chapter|अध्याय)\s+(\d+)\s*(?:[–—\-:]+\s*|\s+)([^\n]{0,120})",
        flags=re.M,
    )
    matches = list(pattern.finditer(text))
    if len(matches) < 2:
        return []
    # Deduplicate by chapter number, first occurrence wins (the story
    # structure section, not a later "01_chapter_01.mp3" mention).
    by_num: dict[int, dict[str, Any]] = {}
    for i, m in enumerate(matches):
        num = int(m.group(1))
        if num in by_num:
            continue
        if num < 1 or num > 24:
            continue
        title = (m.group(2) or "").strip().strip("–—-:.")
        # Skip headings that are clearly file-name instructions.
        if re.search(r"\.mp3|\.mp4|filename|file naming", title, flags=re.I):
            continue
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[m.end() : end].strip()
        # Stop a body at a new PART / ==== section if the next match is far
        # and we crossed a PART header that's not a chapter.
        part = re.search(r"\n={3,}.*\n\s*PART\s+\d+", body)
        if part:
            body = body[: part.start()].strip()
        by_num[num] = {"id": num, "title": title[:120], "brief": body[:6000]}
    out = [by_num[k] for k in sorted(by_num)]
    return out if len(out) >= 2 else []


def coalesce_scenes(scenes: list[dict[str, Any]], limit: int = MAX_SCENES) -> list[dict[str, Any]]:
    """If we have more than `limit` scenes, merge adjacent ones."""
    scenes = [s for s in scenes if isinstance(s, dict)]
    if len(scenes) <= limit:
        return scenes
    # Evenly fold extras into neighbors.
    while len(scenes) > limit:
        # Merge the shortest narration into the next (or previous) scene.
        lengths = [len(str(s.get("narration") or "")) for s in scenes]
        i = min(range(len(scenes) - 1), key=lambda k: lengths[k] + lengths[k + 1])
        a, b = scenes[i], scenes[i + 1]
        a = dict(a)
        a["narration"] = (str(a.get("narration") or "") + " " + str(b.get("narration") or "")).strip()
        a["visual"] = (str(a.get("visual") or "") + " " + str(b.get("visual") or "")).strip()
        try:
            a["duration_sec"] = min(20, int(a.get("duration_sec") or 8) + int(b.get("duration_sec") or 8))
        except (TypeError, ValueError):
            a["duration_sec"] = 20
        scenes = scenes[:i] + [a] + scenes[i + 2 :]
    for i, s in enumerate(scenes, 1):
        s["id"] = i
    return scenes


def merge_chapter_plans(
    parts: list[dict[str, Any]],
    topic: str,
    target: DurationTarget,
) -> dict[str, Any]:
    scenes: list[dict[str, Any]] = []
    stories: list[str] = []
    vos: list[str] = []
    title = ""
    hook = ""
    tags: list[str] = []
    descs: list[str] = []
    thumb = ""
    for i, raw in enumerate(parts):
        p = _clean_raw(raw if isinstance(raw, dict) else {}, topic)
        if not title:
            title = p.get("title") or ""
        if not hook:
            hook = p.get("hook") or ""
        story = (p.get("story") or "").strip()
        if story:
            stories.append(story)
        vo = (p.get("voiceover_script") or "").strip()
        if vo:
            vos.append(vo)
        for s in p.get("scenes") or []:
            if not isinstance(s, dict):
                continue
            item = dict(s)
            try:
                dur = int(item.get("duration_sec") or target.scene_sec)
            except (TypeError, ValueError):
                dur = target.scene_sec
            item["duration_sec"] = max(8, min(20, dur))
            item["id"] = len(scenes) + 1
            item["chapter"] = i + 1
            if item.get("narration") or item.get("image_prompt") or item.get("visual"):
                scenes.append(item)
        for t in p.get("tags") or []:
            if t and str(t) not in tags:
                tags.append(str(t))
        if p.get("description"):
            descs.append(str(p["description"]))
        if not thumb:
            thumb = p.get("thumbnail_prompt") or ""
    scenes = coalesce_scenes(scenes, MAX_SCENES)
    vo = "\n\n".join(vos).strip()
    if not vo:
        vo = " ".join(str(s.get("narration") or "") for s in scenes).strip()
    story = "\n\n".join(stories).strip() or story_from_scenes(scenes)
    return {
        "title": (title or (topic or "")[:80]).strip(),
        "hook": hook,
        "story": story,
        "scenes": scenes,
        "voiceover_script": vo,
        "thumbnail_prompt": thumb,
        "tags": tags[:20],
        "description": "\n\n".join(descs)[:4000],
        "target": target.as_dict(),
        "word_count": word_count(vo),
        "chapter_count": len(parts),
    }


def story_from_scenes(scenes: list[dict[str, Any]]) -> str:
    return " ".join(str(s.get("narration") or "") for s in scenes if s.get("narration")).strip()


def mock_plan_for_target(
    topic: str,
    channel: Optional[dict[str, Any]],
    target: DurationTarget,
) -> dict[str, Any]:
    """Deterministic long plan for DRY_RUN / tests. Not used for live jobs."""
    lang = (channel or {}).get("language") or "Hindi"
    n = max(1, target.scene_count)
    words = max(target.word_target, 40)
    per = max(8, words // n)
    seed = (
        "आधी रात का सन्नाटा पसरा है, कोहरा सड़क पर धीरे-धीरे चल रहा है, "
        "और कहानी एक-एक साँस लेकर आगे बढ़ती है। "
    )
    scenes = []
    vos = []
    for i in range(n):
        # Repeat the seed to approach the per-scene word target.
        unit = f"दृश्य {i + 1}. {seed}"
        narr = unit
        while word_count(narr) < per:
            narr += seed
        narr = " ".join(narr.split()[: per + 4])
        scenes.append({
            "id": i + 1,
            "narration": narr,
            "visual": f"Cinematic beat {i + 1} for {topic[:60]}",
            "image_prompt": (
                f"Photorealistic cinematic still, Indian supernatural atmosphere, "
                f"16:9, scene {i + 1} of a story about {topic[:80]}, no text"
            ),
            "video_prompt": f"Slow cinematic move, scene {i + 1}",
            "duration_sec": int(target.scene_sec),
            "chapter": min(target.chapters, 1 + i * target.chapters // n),
        })
        vos.append(narr)
    title = (topic.strip().split("\n")[0] or "Nayi video")[:80]
    vo = " ".join(vos)
    return {
        "title": title,
        "hook": "रात गहरी है, और यह कहानी अभी शुरू ही हुई है।",
        "story": vo,
        "scenes": scenes,
        "voiceover_script": vo,
        "thumbnail_prompt": f"Cinematic thumbnail for {title}, photorealistic, no text",
        "tags": ["hindi", "kahani"],
        "description": title,
        "target": target.as_dict(),
        "word_count": word_count(vo),
        "chapter_count": target.chapters,
        "language": lang,
    }


def outline_prompt(topic: str, idea: str, channel: Optional[dict[str, Any]], target: DurationTarget) -> str:
    brief = planner_brief(load_profile(), channel)
    lang = (channel or {}).get("language") or "Hindi"
    blob = (topic or "") + ("\n" + idea if idea else "")
    # Don't blow the context: keep a generous but bounded brief.
    clipped = blob[:14000]
    return (
        "You are planning a long YouTube video. First return ONLY an outline JSON, "
        "not the full story.\n\n"
        f"{brief}\n\n"
        f"Target: {target.minutes:g} minutes, {target.word_min}–{target.word_max} {lang} words, "
        f"{target.chapters} chapters, about {target.scene_count} scenes.\n"
        "JSON shape:\n"
        '{"title":"...", "hook":"...", "chapters":[{"id":1,"title":"...","beats":"short beats"}]}\n'
        "Use the user's brief. Do not shorten the requested chapter count.\n\n"
        f"USER BRIEF:\n{clipped}\n"
    )


def chapter_prompt(
    topic: str,
    idea: str,
    channel: Optional[dict[str, Any]],
    target: DurationTarget,
    *,
    chapter: dict[str, Any],
    chapter_index: int,
    chapter_count: int,
    previous_ending: str,
    words_so_far: int,
) -> str:
    brief = planner_brief(load_profile(), channel)
    lang = (channel or {}).get("language") or "Hindi"
    wlo, whi = chapter_word_share(target, chapter_index, chapter_count)
    remaining = max(wlo, target.word_min - words_so_far)
    # Don't ask the last chapters to swallow a huge leftover in one go;
    # keep a per-chapter cap of ~1.4× the share.
    whi = max(whi, min(int(whi * 1.3), remaining if chapter_index == chapter_count - 1 else whi))
    nscenes = chapter_scene_share(target, chapter_count)
    ch_title = chapter.get("title") or f"Chapter {chapter_index + 1}"
    ch_brief = (chapter.get("brief") or chapter.get("beats") or "").strip()
    prev = (previous_ending or "").strip()
    prev_block = (
        f"\nThe previous chapter ended like this (continue, do not repeat):\n{prev[:1200]}\n"
        if prev
        else ""
    )
    user_clip = ((topic or "") + ("\n" + idea if idea else ""))[:4000]
    hint = plan_schema_hint(target, language=lang)
    return (
        "You are writing ONE chapter of a long cinematic video. "
        "Return ONLY one JSON object, no markdown.\n\n"
        f"{brief}\n\n"
        f"Full-video target: {target.minutes:g} minutes, {target.word_min}–{target.word_max} {lang} words, "
        f"{target.scene_count} scenes. Words written so far: {words_so_far}.\n"
        f"THIS CHAPTER: {chapter_index + 1} of {chapter_count} — {ch_title}\n"
        f"Write {wlo}–{whi} {lang} words of FULL prose (not an outline, not a recap). "
        f"Produce about {nscenes} scenes, each {target.scene_sec} seconds "
        f"(duration_sec between 8 and 20). "
        "Narration is spoken slowly by a deep male storyteller. "
        "Include natural dialogue and atmosphere. "
        "Do not put production instructions, SEO, or file names in the voiceover.\n"
        f"{prev_block}\n"
        f"Chapter beats / user brief for this chapter:\n{ch_brief[:5000] or '(use the overall brief)'}\n\n"
        f"Overall user brief (context only):\n{user_clip}\n\n"
        f"{hint}\n"
        "Fill every field. voiceover_script must be speakable as-is and match the scene narrations."
    )


def expansion_prompt(
    topic: str,
    channel: Optional[dict[str, Any]],
    target: DurationTarget,
    *,
    words_so_far: int,
    last_ending: str,
    missing_chapters: list[dict[str, Any]],
) -> str:
    lang = (channel or {}).get("language") or "Hindi"
    need = max(80, target.word_min - words_so_far)
    titles = ", ".join(f"{c.get('id')}: {c.get('title')}" for c in missing_chapters[:8]) or "continuation"
    return (
        "The story is too short for the required duration. Continue from the ending below "
        "and write MORE full prose in the same voice, as new scenes. Return ONLY JSON.\n"
        f"Need about {need} more {lang} words. About {max(3, need // 40)} more scenes, "
        f"duration_sec around {target.scene_sec}. Titles to cover: {titles}.\n"
        f"Do not repeat earlier paragraphs. Ending so far:\n{last_ending[:2000]}\n\n"
        f"{plan_schema_hint(target, language=lang)}\n"
    )


def plan_is_short(plan: dict[str, Any], word_min: int, scene_min: int) -> bool:
    vo = plan.get("voiceover_script") or plan.get("story") or ""
    scenes = plan.get("scenes") or []
    return word_count(vo) < max(20, int(word_min * 0.4)) or len(scenes) < max(1, int(scene_min * 0.4))
