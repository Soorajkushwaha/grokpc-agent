"""Detect and scale a video's target duration, word count, and scene budget.

Short prompts with no explicit length keep the historic ~1-minute default
(6–10 scenes of about 8 seconds). Long briefs that ask for 5–30 minutes,
or a frontend duration selector, are honored instead of being summarized.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Any, Optional

# Measured Hindi edge-tts at a slow storyteller pace is ~111 words/min
# (job-b96e8a9b1e04: 476 words in 257.5s). Charon is typically a bit
# faster. 115 wpm is a conservative budget so a 3-minute target stays
# inside 135–225s even when speech is slow. A brief can still override
# with an explicit word count (the 30-minute prompt asked for 3,800–4,500).
WORDS_PER_MIN = 115
# One cinematic still / Ken Burns beat every 8–20 seconds.
SCENE_SEC_MIN = 8
SCENE_SEC_MAX = 20
SCENE_SEC_DEFAULT = 15
MAX_SCENES = 120
MAX_MINUTES = 30
# Historic short-form default used when nothing in the prompt asks for longer.
DEFAULT_SHORT_MINUTES = 1.0
DEFAULT_SHORT_SCENES = 8
DEFAULT_SHORT_SCENE_SEC = 8

# Words in this many characters of prompt usually means a full brief, not a topic.
LONG_BRIEF_CHARS = 1500


@dataclass
class DurationTarget:
    minutes: float
    word_min: int
    word_max: int
    chapters: int
    scene_count: int
    scene_sec: int
    source: str  # "explicit", "prompt", "default"
    is_long: bool
    notes: list[str] = field(default_factory=list)

    @property
    def duration_sec(self) -> int:
        return max(8, int(round(self.minutes * 60)))

    @property
    def word_target(self) -> int:
        return int(round((self.word_min + self.word_max) / 2))

    def as_dict(self) -> dict[str, Any]:
        return {
            "minutes": self.minutes,
            "duration_sec": self.duration_sec,
            "word_min": self.word_min,
            "word_max": self.word_max,
            "word_target": self.word_target,
            "chapters": self.chapters,
            "scene_count": self.scene_count,
            "scene_sec": self.scene_sec,
            "source": self.source,
            "is_long": self.is_long,
            "notes": list(self.notes),
        }


def _to_int(raw: str) -> int:
    return int(re.sub(r"[^\d]", "", raw) or "0")


def word_count(text: str) -> int:
    return len(re.findall(r"\S+", text or ""))


def _looks_like_long_brief(blob: str) -> bool:
    if len(blob) >= LONG_BRIEF_CHARS:
        return True
    low = blob.lower()
    markers = (
        "complete production",
        "master prompt",
        "target video duration",
        "target narration",
        "part 3",
        "chapter 1",
        "chapter 12",
        "12-chapter",
        "12 chapter",
        "पूर्ण कहानी",
        "पूरी कहानी",
    )
    return any(m in low for m in markers) or ("chapter" in low and "chapter 5" in low)


def _ignore_span(low: str, start: int, end: int) -> bool:
    """True if a duration match is clearly about a hook, scene, or chapter slice."""
    window = low[max(0, start - 50) : min(len(low), end + 50)]
    ignore = (
        "opening",
        "hook",
        "first 30 seconds",
        "first 30 second",
        "0–5 second",
        "0-5 second",
        "cinematic hook",
        "per chapter",
        "each chapter",
        "chapter should",
        "2–3 minutes of narration",
        "2-3 minutes of narration",
        "scene duration",
        "each scene",
        "per scene",
        "scene should",
    )
    return any(k in window for k in ignore)


def _parse_minutes(blob: str) -> tuple[Optional[float], list[str]]:
    notes: list[str] = []
    low = blob.lower()
    candidates: list[tuple[float, str, int]] = []  # minutes, why, position

    # TARGET VIDEO DURATION: 30 minutes  /  Duration: 30 min
    for m in re.finditer(
        r"(?:target(?:\s+video)?\s+duration|video\s+duration|total\s+duration|"
        r"target\s+length|duration\s*:)\s*"
        r"(?:approximately\s+|about\s+|approx\.?\s+)?"
        r"(\d+(?:\.\d+)?)\s*(?:–|-|—|to)?\s*(\d+(?:\.\d+)?)?\s*"
        r"-?\s*(?:minutes?|mins?|min\.?|मिनट)",
        low,
        flags=re.I,
    ):
        a = float(m.group(1))
        b = float(m.group(2) or a)
        val = max(a, b)
        candidates.append((val, "target-duration-field", m.start()))

    # 30-MINUTE, 30 minute, 30 minutes minimum, COMPLETE 30-MINUTE, 30 मिनट
    for m in re.finditer(
        r"(\d+(?:\.\d+)?)\s*(?:–|-|—|to)?\s*(\d+(?:\.\d+)?)?\s*"
        r"-?\s*(?:minutes?|mins?|मिनट)",
        low,
        flags=re.I,
    ):
        if _ignore_span(low, m.start(), m.end()):
            continue
        a = float(m.group(1))
        b = float(m.group(2) or a)
        val = max(a, b)
        # Guard: "8-second" style already excluded; also skip tiny "0.5 minutes".
        if val <= 0:
            continue
        candidates.append((val, "minutes-mention", m.start()))

    # "30-MINUTE INDIAN HORROR" (hyphenated adjective, no space)
    for m in re.finditer(r"(\d+)\s*-\s*minute", low):
        if _ignore_span(low, m.start(), m.end()):
            continue
        candidates.append((float(m.group(1)), "hyphen-minute", m.start()))

    if not candidates:
        # Overall length given only in seconds, e.g. "about 10 seconds total".
        for m in re.finditer(
            r"(?:about|around|approximately|exact(?:ly)?|total|only|short test|"
            r"target)?\s*(?:video\s+)?(?:is\s+|of\s+|for\s+)?"
            r"(\d+)\s*(?:seconds|second|sec)\s*(?:total|only|long)?",
            low,
        ):
            window = low[max(0, m.start() - 40) : min(len(low), m.end() + 20)]
            if any(k in window for k in ("hook", "opening", "0–", "0-", "5–", "5-10", "per scene")):
                continue
            if any(k in window for k in ("total", "about", "exactly", "exact", "short", "test", "only", "target")):
                sec = int(m.group(1))
                if 3 <= sec <= 120:
                    notes.append(f"detected {sec}s from prompt")
                    return (round(sec / 60.0, 3), notes)

        return (None, notes)

    # Prefer an explicit "target duration" field; otherwise the largest
    # whole-video mention (a 30-minute movie that also says "first 30 seconds"
    # is already filtered, so the max is the movie length).
    targeted = [c for c in candidates if c[1] == "target-duration-field"]
    pick_from = targeted or candidates
    minutes = max(c[0] for c in pick_from)
    notes.append(f"detected {minutes:g} minutes from prompt")
    return (minutes, notes)


def _parse_words(blob: str) -> tuple[Optional[int], Optional[int], list[str]]:
    notes: list[str] = []
    # 3,800–4,500 Hindi words / 3800-4500 words / 4000 words
    patterns = (
        r"(?:target\s+(?:narration\s+)?(?:length|word\s+count)\s*:?\s*)?"
        r"(?:approximately\s+|about\s+|approx\.?\s+|around\s+)?"
        r"([\d,]{3,6})\s*(?:–|-|—|to)\s*([\d,]{3,6})\s*(?:hindi\s+)?words",
        r"(?:approximately\s+|about\s+|approx\.?\s+|around\s+)?"
        r"([\d,]{3,6})\s*(?:hindi\s+)?words",
    )
    low = blob.lower()
    for pat in patterns:
        m = re.search(pat, low)
        if not m:
            continue
        a = _to_int(m.group(1))
        b = _to_int(m.group(2)) if m.lastindex and m.lastindex >= 2 and m.group(2) else a
        lo, hi = (min(a, b), max(a, b))
        if lo >= 80:
            notes.append(f"detected word target {lo}–{hi}")
            return lo, hi, notes
    return None, None, notes


def _parse_chapters(blob: str, minutes: float) -> int:
    low = blob.lower()
    for pat in (
        r"(\d+)\s*-\s*chapter",
        r"(\d+)\s+fully\s+developed\s+chapters",
        r"(\d+)\s+complete\s+chapters",
        r"(\d+)\s+chapters",
        r"write\s+the\s+complete\s+story\s+in\s+(\d+)",
    ):
        m = re.search(pat, low)
        if m:
            n = int(m.group(1))
            if 2 <= n <= 24:
                return n
    # Highest "CHAPTER 12" heading.
    nums = [int(x) for x in re.findall(r"chapter\s+(\d+)", low)]
    if nums and max(nums) >= 2:
        return min(24, max(nums))
    if minutes <= 2:
        return 1
    # About one chapter every 2.5 minutes, capped at 12.
    return max(2, min(12, int(round(minutes / 2.5))))


def _parse_requested_scenes(blob: str) -> Optional[int]:
    low = blob.lower()
    m = re.search(
        r"(?:at\s+least\s+|prepare\s+)?(?:at\s+least\s+)?"
        r"(\d+)\s*(?:–|-|—|to)\s*(\d+)\s*(?:individual\s+)?(?:cinematic\s+)?(?:video\s+)?scenes",
        low,
    )
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        mid = int(round((a + b) / 2))
        if 4 <= mid <= MAX_SCENES:
            return mid
    m = re.search(r"(?:exactly|only|just)\s+(\d+)\s+scenes?", low)
    if m:
        n = int(m.group(1))
        if 1 <= n <= MAX_SCENES:
            return n
    return None


def scene_budget(minutes: float, requested: Optional[int] = None) -> tuple[int, int]:
    """Return (scene_count, seconds_per_scene)."""
    duration = max(8.0, minutes * 60.0)
    if minutes <= 1.25 and not requested:
        return DEFAULT_SHORT_SCENES, DEFAULT_SHORT_SCENE_SEC
    if requested:
        count = max(1, min(MAX_SCENES, requested))
        sec = int(round(duration / count))
        sec = max(SCENE_SEC_MIN, min(SCENE_SEC_MAX, sec))
        # If requested count would force scenes longer than 20s, raise the count.
        if duration / count > SCENE_SEC_MAX:
            count = min(MAX_SCENES, int(math.ceil(duration / SCENE_SEC_MAX)))
            sec = int(round(duration / count))
            sec = max(SCENE_SEC_MIN, min(SCENE_SEC_MAX, sec))
        return count, sec
    # Prefer ~15s scenes, clamped to 8–20s, cap 120.
    count = int(round(duration / SCENE_SEC_DEFAULT))
    count = max(1, min(MAX_SCENES, count))
    sec = int(round(duration / count))
    sec = max(SCENE_SEC_MIN, min(SCENE_SEC_MAX, sec))
    return count, sec


def words_for_minutes(minutes: float) -> tuple[int, int]:
    mid = int(round(minutes * WORDS_PER_MIN))
    lo = max(20, int(round(mid * 0.9)))
    hi = max(lo, int(round(mid * 1.15)))
    return lo, hi


def detect_duration_target(
    topic: str,
    idea: str = "",
    target_minutes: Optional[float] = None,
) -> DurationTarget:
    blob = f"{topic or ''}\n{idea or ''}"
    notes: list[str] = []
    source = "default"
    minutes: Optional[float] = None

    if target_minutes is not None:
        try:
            tm = float(target_minutes)
        except (TypeError, ValueError):
            tm = 0.0
        if tm > 0:
            minutes = tm
            source = "explicit"
            notes.append(f"frontend/API target_minutes={tm:g}")

    parsed, pnotes = _parse_minutes(blob)
    notes.extend(pnotes)
    if minutes is None and parsed:
        minutes = parsed
        source = "prompt"

    if minutes is None:
        minutes = DEFAULT_SHORT_MINUTES
        source = "default"

    minutes = max(0.1, min(float(MAX_MINUTES), float(minutes)))

    wlo, whi, wnotes = _parse_words(blob)
    notes.extend(wnotes)
    if wlo is None:
        wlo, whi = words_for_minutes(minutes)
        # Historic short-form scripts are shorter than WORDS_PER_MIN * 1 minute.
        if source == "default" and minutes <= 1.25:
            wlo, whi = 60, 160

    requested_scenes = _parse_requested_scenes(blob)
    scene_count, scene_sec = scene_budget(minutes, requested_scenes)
    chapters = _parse_chapters(blob, minutes)

    is_long = (
        source in {"explicit", "prompt"} and minutes >= 3
    ) or (_looks_like_long_brief(blob) and minutes >= 3)

    # A long brief that somehow didn't parse minutes still defaults to 1 min
    # unless we found a number — that's intentional. If the brief clearly
    # wants a movie-length piece but we missed the number, and it's huge,
    # bump only when a 12-chapter structure is present.
    if source == "default" and _looks_like_long_brief(blob) and chapters >= 8:
        minutes = min(MAX_MINUTES, max(minutes, chapters * 2.5))
        wlo, whi = words_for_minutes(minutes)
        scene_count, scene_sec = scene_budget(minutes, requested_scenes)
        source = "prompt"
        is_long = True
        notes.append(f"long {chapters}-chapter brief; assumed {minutes:g} minutes")

    if requested_scenes:
        notes.append(f"scene budget {scene_count} × {scene_sec}s")

    return DurationTarget(
        minutes=minutes,
        word_min=int(wlo),
        word_max=int(whi or wlo),
        chapters=max(1, chapters),
        scene_count=scene_count,
        scene_sec=scene_sec,
        source=source,
        is_long=bool(is_long),
        notes=notes,
    )


def estimate_production(target: DurationTarget) -> dict[str, Any]:
    """Rough wall-clock and quota estimate. Not a guarantee."""
    tts_chunks = max(target.scene_count, int(math.ceil(target.word_target / 40)))
    # Free-tier Gemini TTS has been observed around 10 RPM, and in this
    # project daily quota ran out after roughly 10–15 requests per model.
    tts_minutes_at_10rpm = math.ceil(tts_chunks / 10)
    plan_calls = 1 + (target.chapters if target.is_long or target.minutes >= 3 else 0)
    return {
        "plan_calls": plan_calls,
        "tts_chunks": tts_chunks,
        "tts_minutes_at_10rpm": tts_minutes_at_10rpm,
        "unique_images": min(40, target.scene_count),
        "estimated_wall_minutes": plan_calls * 0.8 + tts_minutes_at_10rpm + min(40, target.scene_count) * 0.15 + 3,
        "free_tier_note": (
            "A 30-minute job needs on the order of 150–200 Gemini TTS requests. "
            "The free tier often exhausts after a much smaller daily number "
            "(we observed ~10–15 successful requests per model). "
            "Without a paid Gemini plan, a full 30-minute Charon narration "
            "usually cannot finish in a single day."
            if target.minutes >= 15
            else (
                "A 3-minute job needs roughly 12–20 Gemini TTS chunks. "
                "That fits a typical per-minute rate limit with backoff, "
                "but only if the daily free quota is not already used up."
                if target.minutes >= 2
                else ""
            )
        ),
    }


def plan_schema_hint(target: DurationTarget, *, language: str = "Hindi") -> str:
    """JSON-shape instructions that scale with the requested duration."""
    lang = language or "Hindi"
    if not target.is_long and target.minutes <= 1.5 and target.source == "default":
        return f"""
Return ONLY one JSON object (no markdown) with this exact shape:
{{
  "title": "video title in the channel language",
  "hook": "first 3-second hook line",
  "story": "short paragraph of the full story",
  "scenes": [
    {{
      "id": 1,
      "narration": "what the voice says in this scene (channel language, 1-2 slow sentences, ~8 seconds spoken)",
      "visual": "what we see",
      "image_prompt": "detailed English still-image prompt, same setting across scenes, no text in the image",
      "video_prompt": "detailed video/motion prompt",
      "duration_sec": 8
    }}
  ],
  "voiceover_script": "full voiceover, ready to be read aloud, in the channel language, slow horror-storyteller pace",
  "thumbnail_prompt": "thumbnail image prompt",
  "tags": ["tag1", "tag2"],
  "description": "YouTube description, 2-4 short paragraphs, with a CTA"
}}
Use 6 to 10 scenes; prefer exactly 8 scenes of about 8 seconds each (~64 seconds total) unless the user asks otherwise.
Every image_prompt must be English, photorealistic, cinematic, and consistent. Do not put text, watermarks, logos, or letters in the image.
Safety: fear comes only from atmosphere (fog, moonlight, shadow, a distant animal) unless the user's brief requires on-screen characters. No children, no blood, no gore, no weapons.
Each scene narration should be speakable slowly in about 8 seconds. duration_sec should be 8 unless a scene genuinely needs more.
"""

    return f"""
Return ONLY one JSON object (no markdown) with this exact shape:
{{
  "title": "video title in {lang}",
  "hook": "opening hook line in {lang}",
  "story": "this chapter's (or this batch's) full story text in {lang}, detailed prose, not a summary",
  "chapter_id": 1,
  "chapter_title": "chapter title",
  "scenes": [
    {{
      "id": 1,
      "narration": "what the voice says in this scene, in {lang}, spoken slowly",
      "visual": "what we see",
      "image_prompt": "detailed English still-image prompt, consistent characters and setting, no text in the image",
      "video_prompt": "detailed video/motion prompt",
      "duration_sec": {target.scene_sec}
    }}
  ],
  "voiceover_script": "the complete spoken narration for this chapter, in {lang}, ready to be read aloud, no production instructions",
  "thumbnail_prompt": "thumbnail image prompt",
  "tags": ["tag1", "tag2"],
  "description": "YouTube description"
}}

HARD REQUIREMENTS — do not ignore these:
- Target video duration: {target.minutes:g} minutes ({target.duration_sec} seconds).
- Target narration length: {target.word_min}–{target.word_max} {lang} words for the COMPLETE video.
- This call should produce a substantial share of that, not a short summary.
- Use about {target.scene_count} scenes for the complete video (this chapter's share is proportional).
- Each scene is {SCENE_SEC_MIN}–{SCENE_SEC_MAX} seconds (prefer {target.scene_sec}). duration_sec must be in that range.
- 1 scene ≈ {SCENE_SEC_MIN}–{SCENE_SEC_MAX} seconds of spoken narration. Do not write 8 tiny scenes for a long movie.
- voiceover_script must be the full spoken text, equal to (or slightly richer than) the concatenated scene narrations.
- Write in natural {lang} (Devanagari if Hindi). Include dialogue and atmosphere. Do not outline. Do not shorten.
- If the user already supplied a detailed brief or chapter beats, EXPAND them into full prose. Do not compress them into a 1-minute recap.
- Every image_prompt is English, photorealistic, cinematic, consistent characters and locations, no text/watermarks.
- No children, no blood, no gore, no weapons. Characters from the brief ARE allowed.
- Never claim assets were generated. Never include production instructions in the spoken narration.
"""


def chapter_word_share(target: DurationTarget, chapter_index: int, chapter_count: int) -> tuple[int, int]:
    n = max(1, chapter_count)
    lo = max(40, int(round(target.word_min / n)))
    hi = max(lo, int(round(target.word_max / n)))
    return lo, hi


def chapter_scene_share(target: DurationTarget, chapter_count: int) -> int:
    n = max(1, chapter_count)
    return max(2, min(MAX_SCENES, int(math.ceil(target.scene_count / n))))
