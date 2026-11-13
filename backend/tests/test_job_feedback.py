#!/usr/bin/env python3
"""Single-job 409 guard and /api/jobs/{id}/preview. DRY_RUN, no live sites."""
from __future__ import annotations

import base64
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

TMP = Path(tempfile.mkdtemp(prefix="grokpc-feedback-"))
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
        "FEATURE_CREDIT_CHECK": "0",
        "FEATURE_AISTUDIO_VOICE": "0",
        "DEEPSEEK_API_KEY": "",
        "GEMINI_API_KEY": "",
    }
)

from fastapi.testclient import TestClient  # noqa: E402

import db as dbmod  # noqa: E402
import jobs as jobs_mod  # noqa: E402
from main import app  # noqa: E402

AUTH = {"Authorization": "Bearer test-token-please-ignore"}
# A tiny 1x1 JPEG (public domain / well-known minimal JPEG).
TINY_JPEG = base64.b64decode(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wAAADwABQADBAQDAgQDAgUADQYGBgYGBAUGBwcJCQcHCAkKCgoKCgoKCwwMDAwMDAwODg4ODg4QEBAQEBAQEBAQEBAf/"
    "8AAEQgAAQABAwERAAIRAQMRAf/EABQBAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/"
    "aAAgBAQABBQL/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/Af/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8B/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/"
    "aAAgBAQAGPwL/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/If/Z"
)
failed = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global failed
    if cond:
        print(f"  PASS  {name}")
    else:
        failed += 1
        print(f"  FAIL  {name}  {detail}")


def _write_still(job_id: str) -> Path:
    dest = Path(os.environ["OUTPUT_DIR"]) / job_id / "clips"
    dest.mkdir(parents=True, exist_ok=True)
    path = dest / "scene_01.jpg"
    if shutil.which("ffmpeg"):
        subprocess.run(
            [
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                "-f", "lavfi", "-i", "color=c=c0e8ff:s=320x180:d=0.1",
                "-frames:v", "1", str(path),
            ],
            check=True,
        )
    else:
        path.write_bytes(TINY_JPEG if len(TINY_JPEG) > 32 else b"\xff\xd8\xff\xd9")
        if not path.read_bytes()[:2] == b"\xff\xd8":
            path.write_bytes(b"\xff\xd8\xff\xdb" + b"\x00" * 200 + b"\xff\xd9")
    return path


def _write_video(job_id: str) -> Path:
    dest = Path(os.environ["OUTPUT_DIR"]) / f"final_{job_id}.mp4"
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not shutil.which("ffmpeg"):
        return dest
    subprocess.run(
        [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-f", "lavfi", "-i", "color=c=226688:s=320x180:d=1",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-t", "1", str(dest),
        ],
        check=True,
    )
    return dest


def test_409_and_preview() -> None:
    print("== 409 one-job-at-a-time ==")
    dbmod.init_db()
    Path(os.environ["OUTPUT_DIR"]).mkdir(parents=True, exist_ok=True)
    client = TestClient(app)

    blocker = jobs_mod.create_job(channel_id="ch1", topic="blocker")
    jobs_mod.update_job(blocker["id"], status="running")
    current = jobs_mod.active_job()
    check("active_job sees running", bool(current) and current["id"] == blocker["id"], str(current))

    r = client.post(
        "/api/jobs",
        headers=AUTH,
        json={"channel_id": "ch1", "topic": "should be blocked", "idea": ""},
    )
    check("POST is 409 while running", r.status_code == 409, f"{r.status_code} {r.text[:200]}")
    if r.status_code == 409:
        check("409 detail mentions existing job", blocker["id"] in r.text, r.text[:200])

    jobs_mod.update_job(blocker["id"], status="cancelled")
    check("active_job empty after cancel", jobs_mod.active_job() is None, str(jobs_mod.active_job()))

    print("== preview still ==")
    job = jobs_mod.create_job(channel_id="ch1", topic="preview me")
    job_id = job["id"]
    still = _write_still(job_id)
    jobs_mod.append_log(job_id, "info", "Pollinations se 1 scene still", step="visuals")
    jobs_mod.update_job(job_id, media_json=[str(still)], current_step="visuals", status="running")

    r = client.get(f"/api/jobs/{job_id}/preview", headers=AUTH)
    check("preview 200", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
    if r.status_code == 200:
        body = r.json()
        check("preview has log line", "Pollinations" in (body.get("log_line") or ""), str(body.get("log_line")))
        check("preview source is still", body.get("source") == "still", str(body.get("source")))
        img = body.get("image_b64") or ""
        check("preview has image_b64", len(img) > 20, str(len(img)))
        if img:
            raw = base64.b64decode(img)
            check("image decodes", len(raw) > 32, str(len(raw)))

    r = client.get(f"/api/jobs/{job_id}/preview?format=image", headers=AUTH)
    check("preview format=image 200", r.status_code == 200 and r.headers.get("content-type", "").startswith("image/"), f"{r.status_code} {r.headers.get('content-type')}")

    r = client.get(f"/api/jobs/{job_id}/preview?token=test-token-please-ignore")
    check("preview accepts ?token=", r.status_code == 200, str(r.status_code))

    r = client.get(f"/api/jobs/{job_id}/preview")
    check("preview without auth is 401", r.status_code == 401, str(r.status_code))

    r = client.get("/api/jobs/job-does-not-exist/preview", headers=AUTH)
    check("unknown job preview 404", r.status_code == 404, str(r.status_code))

    if shutil.which("ffmpeg"):
        print("== preview video frame ==")
        video = _write_video(job_id)
        if video.is_file():
            jobs_mod.update_job(job_id, final_path=str(video), video_path=str(video), current_step="edit")
            # Make the video newer than the still
            os.utime(video, None)
            r = client.get(f"/api/jobs/{job_id}/preview", headers=AUTH)
            check("video preview 200", r.status_code == 200, f"{r.status_code} {r.text[:120]}")
            if r.status_code == 200:
                body = r.json()
                check("source is video_frame", body.get("source") == "video_frame", str(body.get("source")))
                check("has_video true", body.get("has_video") is True, str(body.get("has_video")))
                check("frame image present", bool(body.get("image_b64")), "no image")
    else:
        print("  SKIP  video frame (no ffmpeg)")

    # Clean so we don't leave a running job if TestClient lifespan kicks the runner
    jobs_mod.update_job(job_id, status="cancelled")


def main() -> int:
    test_409_and_preview()
    print()
    if failed:
        print(f"{failed} FAILED")
        return 1
    print("all passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
