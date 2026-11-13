#!/usr/bin/env python3
"""Long-form duration, chapter planning, TTS chunking, quota, image reuse."""
from __future__ import annotations

import asyncio
import os
import shutil
import sys
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

TMP = Path(tempfile.mkdtemp(prefix="grokpc-long-"))
os.environ.update(
    {
        "AGENT_TOKEN": "test-token-please-ignore",
        "DRY_RUN": "1",
        "HEADLESS": "1",
        "HOST": "127.0.0.1",
        "DB_PATH": str(TMP / "tasks.db"),
        "CHROME_PROFILE_DIR": str(TMP / "chrome"),
        "OUTPUT_DIR": str(TMP / "out"),
        "FRONTEND_ORIGINS": "http://testserver",
        "CHANNELS_PATH": str(TMP / "channels.json"),
        "STYLE_PROFILE_PATH": str(TMP / "style.json"),
        "RUNTIME_SETTINGS_PATH": str(TMP / "settings.json"),
        "WINDOWS_HELPER_URL": "http://127.0.0.1:1",
        "FEATURE_VEO": "0",
        "FEATURE_GROK_IMAGINE": "0",
        "FEATURE_GOOGLE_VIDS": "0",
        "FEATURE_YOUTUBE_UPLOAD": "0",
        "FEATURE_AUTOPILOT": "0",
        "DEEPSEEK_API_KEY": "",
        "GEMINI_API_KEY": "",
    }
)

from duration_target import (  # noqa: E402
    detect_duration_target,
    estimate_production,
    plan_schema_hint,
    scene_budget,
    word_count,
    words_for_minutes,
    WORDS_PER_MIN,
)
from gemini_tts import (  # noqa: E402
    _as_dict,
    backoff_seconds,
    chunk_text,
    classify_gemini_error,
    expand_segments,
    extract_audio_from_response,
    is_speechconfig_400,
    speechconfig_bodies,
)
from voiceover import (  # noqa: E402
    scale_cues,
    tempo_to_fit,
)
from longform import (  # noqa: E402
    coalesce_scenes,
    extract_chapter_headings,
    merge_chapter_plans,
    mock_plan_for_target,
)
from planner import plan_story  # noqa: E402

failed = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global failed
    if cond:
        print(f"  PASS  {name}")
    else:
        failed += 1
        print(f"  FAIL  {name}  {detail}")


USER_BRIEF = """
# ULTIMATE 30-MINUTE INDIAN HORROR MOVIE – COMPLETE PRODUCTION MASTER PROMPT

Your task is to create a COMPLETE 30-MINUTE CINEMATIC INDIAN HORROR MOVIE.

TARGET VIDEO DURATION:
30 minutes minimum.

TARGET NARRATION LENGTH:
Approximately 3,800–4,500 Hindi words. Adjust the final word count according to actual Gemini narration speed.

==================================================
PART 2 – FIRST 30 SECONDS: CINEMATIC HOOK
==================================================

0–5 seconds:
A deserted Indian highway at midnight.

==================================================
PART 3 – COMPLETE 12-CHAPTER STORY
==================================================

Write the complete story in 12 fully developed chapters.

CHAPTER 1 – घर लौटने की आखिरी रात

Introduce Vikas, his family, his father's mysterious death.

CHAPTER 2 – बारह अजनबी

Vikas enters the bus. Introduce all 12 passengers.

CHAPTER 3 – यह बस कहां जा रही है?

The bus moves through unfamiliar roads.

CHAPTER 4 – बीस साल पुरानी दुर्घटना

Vikas finds an old newspaper.

CHAPTER 5 – अगला स्टेशन: श्मशान घाट

The bus stops near an abandoned cremation ground.

CHAPTER 6 – ड्राइवर का चेहरा

The driver turns around. It is his father.

CHAPTER 7 – तेरहवां यात्री

The conductor reveals the truth.

CHAPTER 8 – यात्रियों का असली चेहरा

Passengers reveal their final memories.

CHAPTER 9 – आखिरी पुल

The bus reaches the same bridge.

CHAPTER 10 – पिता का आखिरी बलिदान

The diary reveals the conspiracy.

CHAPTER 11 – सुबह होने से पहले

Vikas must escape the bus.

CHAPTER 12 – आखिरी सफर अभी बाकी है

Several months later. Twist ending.

Each chapter should contain approximately 2–3 minutes of narration.

Divide the entire 30-minute story into 70–90 cinematic scenes.

Provide clear file naming instructions:
01_chapter_01.mp3
"""


def test_detect_user_30min() -> None:
    print("== detect 30-min user brief ==")
    t = detect_duration_target(USER_BRIEF, "")
    check("30 minutes", t.minutes == 30, str(t.minutes))
    check("word min 3800", t.word_min == 3800, str(t.word_min))
    check("word max 4500", t.word_max == 4500, str(t.word_max))
    check("12 chapters", t.chapters == 12, str(t.chapters))
    check("is_long", t.is_long is True, str(t))
    check("source prompt", t.source == "prompt", t.source)
    check("scenes in 70-90 (capped 120)", 70 <= t.scene_count <= 90, str(t.scene_count))
    check("scene sec 8-20", 8 <= t.scene_sec <= 20, str(t.scene_sec))
    check("duration 1800s", t.duration_sec == 1800, str(t.duration_sec))
    # Hook "30 seconds" and per-chapter "2-3 minutes" must not override 30 min.
    check("did not pick hook 30s", t.minutes != 0.5, str(t))
    est = estimate_production(t)
    check("tts chunks many", est["tts_chunks"] >= 90, str(est))
    check("free tier note present", "30-minute" in est["free_tier_note"], est["free_tier_note"][:80])


def test_detect_short_and_explicit() -> None:
    print("== detect short / explicit / hindi ==")
    d = detect_duration_target("Purani haveli ka raaz")
    check("default 1 min", d.minutes == 1.0 and d.source == "default" and d.scene_count == 8, str(d))
    check("default not long", d.is_long is False, str(d))

    s = detect_duration_target(
        "दीये की छोटी लौ",
        "Very short test video, about 10 seconds total. Exactly 1 scene only, duration_sec 10.",
    )
    check("10s total", abs(s.minutes - 10 / 60) < 0.01, str(s))
    check("1 scene 10s", s.scene_count == 1 and s.scene_sec == 10, str(s))

    e = detect_duration_target("ek chhoti kahani", "", target_minutes=3)
    check("explicit 3 min", e.minutes == 3 and e.source == "explicit" and e.is_long, str(e))
    check("3 min ~12 scenes", 9 <= e.scene_count <= 23, str(e.scene_count))
    check("3 min words ~300-400 (115 wpm)", 280 <= e.word_min <= 420, str(e.word_min))
    # Slow Hindi edge-tts (~110 wpm) at word_max must still fit in 225s.
    spoken_slow = e.word_max / 110 * 60
    check("3 min word_max at 110wpm <= 225s", spoken_slow <= 225, str((e.word_max, spoken_slow)))
    # ±25% of 180s is the job's duration tolerance — scene budget should cover it.
    span = e.scene_count * e.scene_sec
    check("3 min scene budget near 180s", 135 <= span <= 240, str((e.scene_count, e.scene_sec, span)))

    h = detect_duration_target("15–20 मिनट की cinematic horror video. पूरी कहानी हिंदी में लिखो।")
    check("hindi 15-20 takes upper 20", h.minutes == 20 and h.is_long, str(h))

    cap = detect_duration_target("Make a 90 minute movie")
    check("cap at 30", cap.minutes == 30, str(cap.minutes))

    count, sec = scene_budget(3)
    check("scene_budget 3min", count <= 120 and 8 <= sec <= 20, str((count, sec)))


def test_chapter_extract_and_merge() -> None:
    print("== chapters + merge ==")
    ch = extract_chapter_headings(USER_BRIEF)
    check("12 chapter headings", len(ch) == 12, str([(c["id"], c["title"]) for c in ch]))
    check("ch1 hindi title", "घर लौटने" in ch[0]["title"], ch[0]["title"])
    check("ch12 title", "आखिरी सफर" in ch[11]["title"], ch[11]["title"])
    check("ch1 has brief body", "Vikas" in ch[0]["brief"], ch[0]["brief"][:80])
    # File-name lines should not become chapters.
    check("no mp3 chapter", all(".mp3" not in c["title"] for c in ch), str(ch))

    t = detect_duration_target("story", "", target_minutes=3)
    parts = [
        {
            "title": "आखिरी बस",
            "hook": "बारह बजकर पंद्रह मिनट",
            "story": "विकास बस में बैठा। " * 20,
            "voiceover_script": "विकास बस में बैठा और कंडक्टर ने टिकट दिया। " * 15,
            "scenes": [
                {
                    "id": 1,
                    "narration": "विकास बस में बैठा।",
                    "visual": "bus",
                    "image_prompt": "old bus at night",
                    "duration_sec": 12,
                },
                {
                    "id": 2,
                    "narration": "कंडक्टर ने टिकट दिया।",
                    "visual": "ticket",
                    "image_prompt": "ticket machine",
                    "duration_sec": 15,
                },
            ],
            "tags": ["horror"],
        },
        {
            "title": "ignored later title",
            "story": "पिताजी मुड़े।",
            "voiceover_script": "पिताजी ने पीछे मुड़कर देखा।",
            "scenes": [
                {
                    "narration": "पिताजी ने पीछे मुड़कर देखा।",
                    "visual": "driver",
                    "image_prompt": "bus driver turns",
                    "duration_sec": 25,  # clamp to 20
                }
            ],
        },
    ]
    merged = merge_chapter_plans(parts, "topic", t)
    check("title from first", merged["title"] == "आखिरी बस", merged["title"])
    check("3 scenes", len(merged["scenes"]) == 3, str(merged["scenes"]))
    check("ids sequential", [s["id"] for s in merged["scenes"]] == [1, 2, 3], str(merged["scenes"]))
    check("duration clamped", merged["scenes"][2]["duration_sec"] == 20, str(merged["scenes"][2]))
    check("word_count > 0", merged["word_count"] > 10, str(merged["word_count"]))
    check("voiceover concatenates", "कंडक्टर" in merged["voiceover_script"] and "पिताजी" in merged["voiceover_script"], merged["voiceover_script"][:200])

    many = [{"id": i, "narration": f"s{i}", "duration_sec": 8} for i in range(1, 150)]
    folded = coalesce_scenes(many, 120)
    check("coalesce to 120", len(folded) == 120, str(len(folded)))
    check("coalesce ids", folded[-1]["id"] == 120, str(folded[-1]))


def test_mock_and_dry_plan() -> None:
    print("== mock long plan + dry_run ==")
    t = detect_duration_target("एक छोटी सी भूतिया बस की कहानी", "", target_minutes=3)
    plan = mock_plan_for_target("एक छोटी सी भूतिया बस की कहानी", {"language": "Hindi"}, t)
    wc = word_count(plan["voiceover_script"])
    check("mock scene count matches", len(plan["scenes"]) == t.scene_count, str(len(plan["scenes"])))
    check("mock words near target", wc >= int(t.word_min * 0.75), f"wc={wc} min={t.word_min}")
    dur = sum(int(s["duration_sec"]) for s in plan["scenes"])
    check("mock duration near 3min ±25%", 135 <= dur <= 225, str(dur))

    result = asyncio.run(plan_story("Dry topic", "idea", {"language": "Hindi", "name": "Ch1"}, dry_run=True))
    check("short dry still mock", result["planner"] == "mock" and len(result["plan"]["scenes"]) == 4, str(result["plan"]))

    result3 = asyncio.run(
        plan_story("भूतिया बस", "", {"language": "Hindi"}, dry_run=True, target_minutes=3)
    )
    check("3min dry uses long mock", result3["planner"] == "mock", str(result3))
    check("3min dry enough scenes", len(result3["plan"]["scenes"]) >= 9, str(len(result3["plan"]["scenes"])))
    check("3min dry target recorded", (result3.get("target") or {}).get("minutes") == 3, str(result3.get("target")))

    hint_short = plan_schema_hint(detect_duration_target("hi"))
    hint_long = plan_schema_hint(t)
    check("short hint has 8 second default", "8 seconds" in hint_short or "8 scenes" in hint_short, hint_short[:120])
    check("long hint has word target", str(t.word_min) in hint_long and "Do not compress" in hint_long or "Do not shorten" in hint_long, hint_long[:200])


def test_quota_and_tts_helpers() -> None:
    print("== quota classifier + TTS chunking ==")
    daily = classify_gemini_error(
        {
            "error": {
                "code": 429,
                "message": "You exceeded your current quota, please check your plan and billing details.",
                "status": "RESOURCE_EXHAUSTED",
                "details": [
                    {
                        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                        "reason": "QUOTA_EXCEEDED",
                        "metadata": {
                            "quota_id": "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
                            "quota_metric": "generate_content_free_tier_requests",
                            "quota_limit": "10",
                        },
                    }
                ],
            }
        }
    )
    check("daily quota flag", daily.daily and not daily.rate_limit, str((daily.daily, daily.rate_limit, daily.quota_id)))
    check("daily friendly mentions free", "free" in daily.friendly().lower() and "quota" in daily.friendly().lower(), daily.friendly())

    rate = classify_gemini_error(
        {
            "error": {
                "code": 429,
                "message": "Resource exhausted",
                "status": "RESOURCE_EXHAUSTED",
                "details": [
                    {
                        "reason": "RATE_LIMIT_EXCEEDED",
                        "metadata": {"quota_id": "GenerateRequestsPerMinutePerProjectPerModel-FreeTier"},
                    },
                    {"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "16s"},
                ],
            }
        }
    )
    check("rate limit flag", rate.rate_limit and not rate.daily, str((rate.rate_limit, rate.daily, rate.retry_delay)))
    check("retryDelay 16s", abs(rate.retry_delay - 16) < 0.1, str(rate.retry_delay))

    ambiguous = classify_gemini_error(
        "429 RESOURCE_EXHAUSTED. {'error': {'code': 429, 'message': "
        "'You exceeded your current quota, please check your plan and billing details.'}}"
    )
    check("ambiguous 429 treated as daily (no silent degrade)", ambiguous.daily, str(ambiguous.friendly()))

    sc = "400 INVALID_ARGUMENT. Unknown name \"speechConfig\" at 'generation_config': Cannot find field."
    check("speechConfig 400 detected", is_speechconfig_400(sc), sc)

    bodies = speechconfig_bodies("hello", "Charon", "Hindi")
    check("several REST shapes", len(bodies) >= 3, str(len(bodies)))
    first = bodies[0]
    cfg = first["generationConfig"]
    check("official speechConfig nest", "speechConfig" in cfg and "voiceConfig" in cfg["speechConfig"], str(cfg))
    check("Charon voice", cfg["speechConfig"]["voiceConfig"]["prebuiltVoiceConfig"]["voiceName"] == "Charon", str(cfg))

    pcm = b"\x00\x01" * 10
    import base64
    data = {"candidates": [{"content": {"parts": [{"inlineData": {"mimeType": "audio/L16;rate=24000", "data": base64.b64encode(pcm).decode()}}]}}]}
    raw, mime = extract_audio_from_response(data)
    check("extract audio bytes", raw == pcm and "L16" in mime, str(mime))

    chunks = chunk_text("पहला वाक्य है। " * 80, max_chars=120, max_words=20)
    check("chunk splits long text", len(chunks) >= 4, str(len(chunks)))
    check("chunks under cap", all(len(c) <= 200 for c in chunks), str([len(c) for c in chunks]))

    segs = expand_segments([{"text": "एक। दो। तीन। चार। पांच। छह। सात। आठ।", "min_sec": 16}], max_chars=20, max_words=4)
    check("expand_segments splits", len(segs) >= 2, str(segs))

    wait = backoff_seconds(0, retry_delay=15)
    check("backoff honors retryDelay", 15 <= wait <= 20, str(wait))


def test_image_reuse() -> None:
    print("== pollinations reuse on 402 ==")
    from still_gen import generate_pollinations_images, image_specs, MAX_SCENES

    check("MAX_SCENES raised", MAX_SCENES >= 120, str(MAX_SCENES))
    plan = {
        "scenes": [
            {"id": i, "image_prompt": f"foggy bus scene {i}", "duration_sec": 12, "narration": f"n{i}"}
            for i in range(1, 7)
        ]
    }
    specs = image_specs(plan, limit=120)
    check("image_specs not capped at 10", len(specs) == 6, str(len(specs)))

    dest = TMP / "stills"
    dest.mkdir(exist_ok=True)
    fake = TMP / "good.jpg"
    # minimal JPEG-ish header + size
    fake.write_bytes(b"\xff\xd8\xff" + b"\x00" * 20000)

    calls = {"n": 0}

    async def fake_fetch(prompt, dest_path, **kwargs):
        calls["n"] += 1
        # Succeed only the first scene; the rest 402.
        if calls["n"] == 1:
            out = Path(dest_path).with_suffix(".jpg")
            out.write_bytes(fake.read_bytes())
            return out
        raise RuntimeError("Pollinations failed: Client error '402 Payment Required' for url 'https://image.pollinations.ai/prompt/x'")

    async def _go():
        with patch("still_gen.fetch_pollinations", side_effect=fake_fetch):
            return await generate_pollinations_images(plan, dest, job_id="job-test", log=None)

    result = asyncio.run(_go())
    check("reuse status ok", result["status"] == "ok", str(result))
    check("all 6 scenes have a file", len(result["paths"]) == 6, str(result["paths"]))
    check("note mentions reuse", "reused" in (result.get("note") or "").lower() or "Ken Burns" in (result.get("note") or ""), result.get("note"))
    check("files exist", all(Path(p).is_file() for p in result["paths"]), str(result["paths"]))
    # After two 402s we stop fetching — calls should be 1 success + 2 fails = 3, not 6.
    check("stopped after consecutive 402s", calls["n"] <= 4, str(calls["n"]))


def test_cascaded_tts_per_chunk() -> None:
    print("== per-chunk TTS fallback ==")
    from gemini_tts import GeminiTTSError
    from voiceover import VoiceResult, _synth_cascaded, wrap_pcm_to_wav, write_silent_audio, _write_silence_wav
    import wave

    work = TMP / "voicework"
    work.mkdir(exist_ok=True)
    segs = [{"text": "पहला वाक्य है जी।", "min_sec": 0}, {"text": "दूसरा वाक्य है जी।", "min_sec": 0}]
    logs: list[str] = []

    async def log(d):
        logs.append(str(d.get("message") or d.get("title") or ""))

    calls = {"g": 0}

    async def fake_gemini(text, dest, **kwargs):
        calls["g"] += 1
        if calls["g"] == 1:
            # Write a tiny valid wav (~0.2s)
            dest = Path(dest).with_suffix(".wav")
            dest.parent.mkdir(parents=True, exist_ok=True)
            with wave.open(str(dest), "w") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(24000)
                w.writeframes(b"\x00\x00" * 4800)
            return dest
        raise GeminiTTSError(
            "quota",
            status=429,
            quota_id="GenerateRequestsPerDayPerProjectPerModel-FreeTier",
            daily=True,
        )

    async def fake_edge(text, dest, **kwargs):
        dest = Path(dest).with_suffix(".wav")
        dest.parent.mkdir(parents=True, exist_ok=True)
        with wave.open(str(dest), "w") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(24000)
            w.writeframes(b"\x00\x00" * 3600)
        return dest

    async def _go():
        with (
            patch("voiceover._gemini_tts_one", side_effect=fake_gemini),
            patch("voiceover._edge_tts_one", side_effect=fake_edge),
        ):
            return await _synth_cascaded(segs, work, "Hindi", log, use_gemini=True)

    wav, cues, dur, engine, note = asyncio.run(_go())
    check("mixed engine", engine.startswith("mixed:") or "quota" in engine, engine)
    check("quota mentioned", "quota" in (note + engine + " ".join(logs)).lower(), note + engine)
    check("two cues", len(cues) == 2, str(cues))
    engines = [c.get("engine") for c in cues]
    check("first chunk gemini", isinstance(engines[0], str) and engines[0].startswith("gemini:"), str(engines))
    check("second chunk fallback", engines[1] in {"edge-tts", "gtts"} or str(engines[1]).startswith("edge"), str(engines))
    check("voice: logged", any("voice:" in m for m in logs), str(logs)[:400])
    check("wav exists", Path(wav).is_file(), str(wav))


def test_jobs_api_target_minutes() -> None:
    print("== jobs API target_minutes ==")
    import db as dbmod
    from fastapi.testclient import TestClient
    import channels as channels_mod
    from main import app

    dbmod.init_db()
    channels_mod.ensure_defaults()
    client = TestClient(app)
    AUTH = {"Authorization": "Bearer test-token-please-ignore"}
    ch = client.get("/api/channels", headers=AUTH).json()["channels"][0]["id"]
    r = client.post(
        "/api/jobs",
        headers=AUTH,
        json={"channel_id": ch, "topic": "भूतिया बस की कहानी", "target_minutes": 3},
    )
    check("create 200", r.status_code in {200, 201}, f"{r.status_code} {r.text[:200]}")
    job = (r.json() or {}).get("job") or {}
    check("target_minutes stored", job.get("target_minutes") == 3, str(job.get("target_minutes")))
    # DRY_RUN pipeline will complete a 3-min mock — that could be heavy (12 scenes of silence).
    # Just confirm GET returns the field; cancel if it's running long.
    jid = job.get("id")
    if jid:
        g = client.get(f"/api/jobs/{jid}", headers=AUTH)
        check("get has target", (g.json().get("job") or {}).get("target_minutes") == 3, g.text[:200])
        client.post(f"/api/jobs/{jid}/cancel", headers=AUTH)



def test_word_budget_and_tempo() -> None:
    print("== word budget + atempo fit ==")
    check("WORDS_PER_MIN conservative", 100 <= WORDS_PER_MIN <= 120, str(WORDS_PER_MIN))
    lo, hi = words_for_minutes(3)
    check("3min mid around 345", 300 <= ((lo + hi) / 2) <= 400, str((lo, hi)))
    slow = hi / 110 * 60
    check("word_max at 110wpm inside 225s", slow <= 225, str((hi, slow)))
    # This is the actual 3-min verification job: 476 words / 257.5s at the old 140 wpm budget.
    # New budget must not request that many words.
    check("new 3min word_max < 476", hi < 476, str(hi))
    t = tempo_to_fit(200, 180)
    check("200s in 135-225 window: no tempo", t == 1.0, str(t))
    t = tempo_to_fit(257.52, 180)
    check("257s needs ~1.144", 1.14 <= t <= 1.15, str(t))
    check("257s after tempo <= 225", 257.52 / t <= 225.01, str(257.52 / t))
    t = tempo_to_fit(400, 180)
    check("huge overshoot capped at 1.15", abs(t - 1.15) < 1e-9, str(t))
    t = tempo_to_fit(100, 180)
    check("short audio not sped up", t == 1.0, str(t))
    t = tempo_to_fit(0, 180)
    check("zero duration safe", t == 1.0, str(t))
    cues = [
        {"start": 0.0, "end": 22.752, "text": "a", "engine": "edge-tts"},
        {"start": 23.202, "end": 45.954, "text": "b", "engine": "edge-tts"},
    ]
    sc = scale_cues(cues, 1.15)
    check("cue engine preserved", sc[0]["engine"] == "edge-tts" and sc[0]["text"] == "a", str(sc))
    check("cue end scaled", abs(sc[0]["end"] - 22.752 / 1.15) < 0.01, str(sc[0]))
    check("original cues not mutated", cues[0]["end"] == 22.752, str(cues[0]))
    check("tempo 1 keeps times", scale_cues(cues, 1.0)[1]["end"] == 45.954, str(scale_cues(cues, 1.0)))


def test_as_dict_skips_async_json() -> None:
    print("== _as_dict does not await async json ==")
    import gc
    import warnings

    class FakeCoroResp:
        def json(self):
            async def _coro():
                return {"error": {"message": "should not be read via coro"}}
            return _coro()

        @property
        def text(self):
            return '{"error":{"message":"You exceeded your current quota"}}'

    class FakeAsyncDefResp:
        async def json(self):
            return {"error": {"message": "async def json"}}

        @property
        def text(self):
            return '{"error":{"message":"You exceeded your current quota"}}'

    class FakeExc(Exception):
        def __init__(self, resp):
            self.response = resp
            super().__init__("GenerateContentPerDay quota exceeded")

    for label, resp in (("returns-coro", FakeCoroResp()), ("async-def", FakeAsyncDefResp())):
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            data = _as_dict(FakeExc(resp))
            gc.collect()
            never = [str(w.message) for w in caught if "never awaited" in str(w.message).lower()]
        check(f"{label} no unawaited warning", not never, str(never))
        blob = str(data).lower()
        check(f"{label} still has quota text", "quota" in blob, blob[:200])


def main() -> int:
    test_detect_user_30min()
    test_detect_short_and_explicit()
    test_chapter_extract_and_merge()
    test_mock_and_dry_plan()
    test_quota_and_tts_helpers()
    test_image_reuse()
    test_cascaded_tts_per_chunk()
    test_jobs_api_target_minutes()
    test_word_budget_and_tempo()
    test_as_dict_skips_async_json()
    print()
    if failed:
        print(f"{failed} FAILED")
        return 1
    print("ALL PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
