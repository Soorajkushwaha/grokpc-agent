"""GrokPC FastAPI server — video-production jobs + the existing vision agent.

Phase 1 adds jobs/channels/pipeline APIs. The live /api/task vision loop (the
one that already opened YouTube) is unchanged. Messaging endpoints are gone.
Phase 2 features are flag-gated and default OFF.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any, Optional

import uvicorn
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from starlette.websockets import WebSocket, WebSocketDisconnect

from agent_core import BrowserAgentCore
from auth import cors_origins, require_auth, token_from_ws, tokens_match
from channels import add_channel, delete_channel, get_channel, list_channels, update_channel
from config import (
    ANDROID,
    DRY_RUN,
    FEATURE_AUTOPILOT,
    FEATURE_YOUTUBE_UPLOAD,
    HOST,
    PORT,
    feature_flags,
    pipeline_steps,
    require_token,
)
from db import budget_summary, init_db, today_stats
from desktop_client import helper_status
from jobs import (
    append_log,
    cancel_job,
    create_job,
    get_job,
    list_jobs,
    list_logs,
    pause_job,
    resume_job,
    running_job,
    update_job,
)
from novnc_proxy import router as novnc_router
from pipeline import PipelineRunner
from runtime_settings import load_settings, save_settings
from style_profile import load_profile, save_profile
from video_pipeline import render_video

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("grokpc.main")

clients: list[WebSocket] = []
agent: Optional[BrowserAgentCore] = None
runner: Optional[PipelineRunner] = None
_main_loop: Optional[asyncio.AbstractEventLoop] = None


async def broadcast(payload: dict[str, Any]) -> None:
    if "timestamp" not in payload:
        payload["timestamp"] = time.strftime("%H:%M:%S")
    if "id" not in payload:
        payload["id"] = f"log-{uuid.uuid4().hex[:10]}"
    text = json.dumps(payload, default=str)
    dead: list[WebSocket] = []
    for ws in list(clients):
        try:
            await ws.send_text(text)
        except Exception:
            dead.append(ws)
    for ws in dead:
        if ws in clients:
            clients.remove(ws)


def _port_open(host: str, port: int) -> bool:
    import socket

    try:
        with socket.create_connection((host, port), timeout=0.3):
            return True
    except OSError:
        return False


def _health_payload() -> dict[str, Any]:
    import os
    import shutil

    total, used, _free = shutil.disk_usage("/")
    mem_total_gb = mem_used_gb = cpu = None
    try:
        with open("/proc/meminfo") as f:
            info = {}
            for line in f:
                key, _, rest = line.partition(":")
                info[key] = int(rest.split()[0])
            mem_total_gb = round(info.get("MemTotal", 0) / 1024 / 1024, 1)
            avail = info.get("MemAvailable", 0) / 1024 / 1024
            mem_used_gb = round(mem_total_gb - avail, 1) if mem_total_gb else None
    except Exception:
        pass
    try:
        with open("/proc/loadavg") as f:
            cpu = round(float(f.read().split()[0]) * 25, 1)
    except Exception:
        pass
    gdrive = "/mnt/gdrive"
    return {
        "connected": True,
        "hostname": os.uname().nodename,
        "os": " ".join(os.uname()),
        "architecture": os.uname().machine,
        "cpuUsagePercent": cpu or 0,
        "cpuCores": os.cpu_count() or 1,
        "ramTotalGb": mem_total_gb or 0,
        "ramUsedGb": mem_used_gb or 0,
        "diskTotalGb": round(total / (1024**3), 1),
        "diskUsedGb": round(used / (1024**3), 1),
        "chromeProfileLocked": os.path.exists("/data/chrome_profile/SingletonLock"),
        "gdriveMounted": os.path.isdir(gdrive) and os.path.ismount(gdrive),
        "novncPortActive": _port_open("127.0.0.1", 6080),
        "fastapiPortActive": True,
        "dryRun": DRY_RUN,
        "lastPing": int(time.time() * 1000),
        "android": ANDROID,
        "agentBusy": bool(agent and agent.is_busy),
    }


async def _status_payload() -> dict[str, Any]:
    health = _health_payload()
    stats = today_stats()
    settings = load_settings()
    current = running_job()
    if current is None and runner and runner.current_job_id:
        current = get_job(runner.current_job_id)
    helper = await helper_status()
    return {
        "ok": True,
        "phase": 1,
        "features": feature_flags(),
        "steps": pipeline_steps(),
        "dryRun": DRY_RUN,
        "busy": bool(agent and agent.is_busy) or bool(current),
        "agentBusy": bool(agent and agent.is_busy),
        "currentJob": (
            {
                "id": current["id"],
                "topic": current["topic"],
                "status": current["status"],
                "current_step": current["current_step"],
                "channel_id": current["channel_id"],
            }
            if current
            else None
        ),
        "helper": helper,
        "autopilot": {
            "feature": FEATURE_AUTOPILOT,
            "enabled": bool(settings.get("autopilot_enabled")) and FEATURE_AUTOPILOT,
            "quiet_hours": settings.get("quiet_hours"),
            "idle_seconds": settings.get("idle_seconds"),
            "daily_video_cap": settings.get("daily_video_cap"),
            "daily_spend_cap_inr": settings.get("daily_spend_cap_inr"),
        },
        "today": {
            "videos": stats["videosToday"],
            "spendInr": stats["spendInrToday"],
            "videoCap": settings.get("daily_video_cap"),
            "spendCapInr": settings.get("daily_spend_cap_inr"),
        },
        "channels": len(list_channels()),
        "health": {
            "hostname": health["hostname"],
            "ramUsedGb": health["ramUsedGb"],
            "ramTotalGb": health["ramTotalGb"],
            "novncPortActive": health["novncPortActive"],
        },
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    global agent, runner, _main_loop
    require_token()
    init_db()
    from channels import ensure_defaults

    ensure_defaults()
    load_profile()
    _main_loop = asyncio.get_running_loop()
    agent = BrowserAgentCore(log_callback=broadcast)
    runner = PipelineRunner(agent=agent, broadcast=broadcast)
    await runner.start()
    # Phase 2 autopilot loop is intentionally not started unless the flag is on.
    if FEATURE_AUTOPILOT:
        logger.info("FEATURE_AUTOPILOT=1 — scaffold is present; enable the toggle in Settings to use it")
    yield
    if runner:
        await runner.stop()
    if agent:
        await agent.close()


app = FastAPI(title="GrokPC Agent", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)
app.include_router(novnc_router)


# ---------------------------------------------------------------------------
# Health, budget, compact status (for Grok Bot supervision)
# ---------------------------------------------------------------------------


@app.get("/api/health")
async def get_health(_auth: str = Depends(require_auth)):
    body = _health_payload()
    try:
        body["features"] = feature_flags()
        body["phase"] = 1
        current = running_job()
        body["currentJobId"] = current["id"] if current else None
    except Exception:
        pass
    return body


@app.get("/api/budget")
async def get_budget(_auth: str = Depends(require_auth)):
    summary = budget_summary()
    summary.update(today_stats())
    settings = load_settings()
    summary["dailyVideoCap"] = settings.get("daily_video_cap")
    summary["dailySpendCapInr"] = settings.get("daily_spend_cap_inr")
    return summary


@app.get("/api/status")
async def get_status(_auth: str = Depends(require_auth)):
    return await _status_payload()


@app.get("/api/credits")
async def get_credits(_auth: str = Depends(require_auth)):
    """Phase 2 balances. When the flag is off we only report spend, not site quotas."""
    from config import FEATURE_CREDIT_CHECK

    stats = today_stats()
    return {
        "phase": 2 if FEATURE_CREDIT_CHECK else 1,
        "feature": FEATURE_CREDIT_CHECK,
        "todaySpendInr": stats["spendInrToday"],
        "providers": [],
        "note": (
            "Live Veo/Grok credit scrape is Phase 2 and off by default."
            if not FEATURE_CREDIT_CHECK
            else "Credit check enabled — run a generate step to record a decision."
        ),
    }


# ---------------------------------------------------------------------------
# Channels + style + runtime settings
# ---------------------------------------------------------------------------


@app.get("/api/channels")
async def api_list_channels(_auth: str = Depends(require_auth)):
    return {"channels": list_channels()}


class ChannelIn(BaseModel):
    name: str
    niche: str = ""
    language: str = "Hindi"
    style: str = ""
    youtube_url: str = ""
    schedule: Optional[dict[str, Any]] = None
    aspect: str = "16:9"
    enabled: bool = True
    id: Optional[str] = None


@app.post("/api/channels")
async def api_add_channel(req: ChannelIn, _auth: str = Depends(require_auth)):
    try:
        ch = add_channel(req.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"channel": ch}


@app.put("/api/channels/{channel_id}")
async def api_update_channel(channel_id: str, req: ChannelIn, _auth: str = Depends(require_auth)):
    try:
        ch = update_channel(channel_id, req.model_dump())
    except KeyError:
        raise HTTPException(status_code=404, detail="Unknown channel")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"channel": ch}


@app.delete("/api/channels/{channel_id}")
async def api_delete_channel(channel_id: str, _auth: str = Depends(require_auth)):
    try:
        delete_channel(channel_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Unknown channel")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True}


@app.get("/api/style-profile")
async def api_get_style(_auth: str = Depends(require_auth)):
    return {"profile": load_profile()}


@app.put("/api/style-profile")
async def api_put_style(payload: dict[str, Any], _auth: str = Depends(require_auth)):
    return {"profile": save_profile(payload)}


@app.get("/api/settings")
async def api_get_settings(_auth: str = Depends(require_auth)):
    return {"settings": load_settings(), "features": feature_flags()}


class SettingsIn(BaseModel):
    quiet_hours: Optional[str] = None
    idle_seconds: Optional[int] = None
    daily_video_cap: Optional[int] = None
    daily_spend_cap_inr: Optional[float] = None
    autopilot_enabled: Optional[bool] = None


@app.put("/api/settings")
@app.post("/api/settings")
async def api_put_settings(req: SettingsIn, _auth: str = Depends(require_auth)):
    data = save_settings(req.model_dump(exclude_none=True))
    return {"settings": data, "features": feature_flags()}


@app.get("/api/autopilot")
async def api_get_autopilot(_auth: str = Depends(require_auth)):
    settings = load_settings()
    from scheduler import should_run_autopilot

    ok, reason = should_run_autopilot(settings)
    return {
        "feature": FEATURE_AUTOPILOT,
        "enabled": bool(settings.get("autopilot_enabled")) and FEATURE_AUTOPILOT,
        "would_run": ok,
        "reason": reason,
        "settings": settings,
        "note": None if FEATURE_AUTOPILOT else "Phase 2 — FEATURE_AUTOPILOT is off. Toggle does nothing until the flag is enabled.",
    }


class AutopilotIn(BaseModel):
    enabled: bool


@app.post("/api/autopilot")
async def api_set_autopilot(req: AutopilotIn, _auth: str = Depends(require_auth)):
    data = save_settings({"autopilot_enabled": req.enabled})
    return {
        "feature": FEATURE_AUTOPILOT,
        "enabled": bool(data.get("autopilot_enabled")) and FEATURE_AUTOPILOT,
        "settings": data,
    }


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------


class JobIn(BaseModel):
    channel_id: str
    topic: str
    idea: str = ""
    autopilot: bool = False


@app.get("/api/jobs")
async def api_list_jobs(
    limit: int = 50,
    status: Optional[str] = None,
    channel_id: Optional[str] = None,
    _auth: str = Depends(require_auth),
):
    return {"jobs": list_jobs(limit=limit, status=status, channel_id=channel_id)}


@app.post("/api/jobs")
async def api_create_job(req: JobIn, _auth: str = Depends(require_auth)):
    topic = req.topic.strip()
    if not topic:
        raise HTTPException(status_code=400, detail="Topic is required")
    if req.channel_id and not get_channel(req.channel_id):
        # Still allow unknown ids so tests / first-run can pass a placeholder,
        # but prefer known channels.
        if not req.channel_id.startswith("ch"):
            raise HTTPException(status_code=404, detail="Unknown channel")
    job = create_job(
        channel_id=req.channel_id,
        topic=topic,
        idea=req.idea.strip(),
        autopilot=req.autopilot,
    )
    await broadcast(
        {
            "type": "system",
            "title": "New job",
            "message": f"{job['topic']} ({job['id']})",
            "jobId": job["id"],
        }
    )
    if runner:
        await runner.enqueue_and_kick(job["id"])
    return {"job": job, "status": "queued"}


@app.get("/api/jobs/{job_id}")
async def api_get_job(job_id: str, _auth: str = Depends(require_auth)):
    job = get_job(job_id, with_logs=True, log_limit=80)
    if not job:
        raise HTTPException(status_code=404, detail="Unknown job")
    return {"job": job}


@app.get("/api/jobs/{job_id}/logs")
async def api_job_logs(job_id: str, limit: int = 200, _auth: str = Depends(require_auth)):
    if not get_job(job_id):
        raise HTTPException(status_code=404, detail="Unknown job")
    return {"logs": list_logs(job_id, limit=limit)}


@app.post("/api/jobs/{job_id}/pause")
async def api_pause_job(job_id: str, _auth: str = Depends(require_auth)):
    if not get_job(job_id):
        raise HTTPException(status_code=404, detail="Unknown job")
    job = pause_job(job_id)
    await broadcast({"type": "system", "title": "Job paused", "message": job_id, "jobId": job_id})
    return {"job": job}


@app.post("/api/jobs/{job_id}/resume")
async def api_resume_job(job_id: str, _auth: str = Depends(require_auth)):
    if not get_job(job_id):
        raise HTTPException(status_code=404, detail="Unknown job")
    job = resume_job(job_id)
    if runner:
        await runner.enqueue_and_kick(job_id)
    await broadcast({"type": "system", "title": "Job resumed", "message": job_id, "jobId": job_id})
    return {"job": job}


@app.post("/api/jobs/{job_id}/cancel")
async def api_cancel_job(job_id: str, _auth: str = Depends(require_auth)):
    if not get_job(job_id):
        raise HTTPException(status_code=404, detail="Unknown job")
    job = cancel_job(job_id)
    await broadcast({"type": "system", "title": "Job cancelled", "message": job_id, "jobId": job_id})
    return {"job": job}


@app.post("/api/jobs/{job_id}/approve-publish")
async def api_approve_publish(job_id: str, _auth: str = Depends(require_auth)):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Unknown job")
    if not FEATURE_YOUTUBE_UPLOAD:
        raise HTTPException(
            status_code=409,
            detail="YouTube publish is Phase 2 and FEATURE_YOUTUBE_UPLOAD is off. The final file is already on disk.",
        )
    if not job.get("youtube_id"):
        raise HTTPException(status_code=409, detail="This job has no private YouTube upload yet")
    from youtube_upload import approve_publish

    result = await approve_publish(job["youtube_id"], agent=agent, log=broadcast)
    if result.get("status") in {"ok", "success"}:
        append_log(job_id, "info", "Approved publish (Public)", step="upload")
        job = update_job(job_id, youtube_privacy="public", status="completed")
    else:
        append_log(job_id, "error", f"Publish failed: {result}", step="upload")
    return {"job": job, "result": result}


# ---------------------------------------------------------------------------
# Existing vision task + leftover video shortcut (kept working)
# ---------------------------------------------------------------------------


class OpenUrlRequest(BaseModel):
    url: str


class TaskRequest(BaseModel):
    prompt: str


class VideoRequest(BaseModel):
    topic: str
    script: str = ""
    language: str = "Hindi"
    duration_seconds: int = 15
    use_google_vids: bool = False
    channel_id: str = ""


@app.post("/api/browser/open")
async def api_open_url(req: OpenUrlRequest, _auth: str = Depends(require_auth)):
    """Open a URL in the visible persistent Chrome profile. No typing, no clicks."""
    if agent is None:
        raise HTTPException(status_code=503, detail="Agent is not ready")
    url = (req.url or "").strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="url must start with http:// or https://")
    if len(url) > 2000:
        raise HTTPException(status_code=400, detail="url too long")
    return await agent.open_visible_url(url)


@app.post("/api/task")
async def run_task(req: TaskRequest, _auth: str = Depends(require_auth)):
    """Unchanged vision-agent entry point — 'youtube kholo' still goes here."""
    prompt = req.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Empty prompt")

    async def _run():
        try:
            result = await agent.run_generic_task(prompt)
            await broadcast({"type": "action", "title": "Agent finished", "message": str(result.get("result") or result)[:800]})
        except Exception as exc:
            logger.exception("task")
            await broadcast({"type": "error", "title": "Task failed", "message": str(exc)})

    asyncio.create_task(_run())
    return {"status": "started", "message": "Vision agent started"}


@app.post("/api/vids/generate")
@app.post("/api/video/generate")
async def generate_video(req: VideoRequest, _auth: str = Depends(require_auth)):
    """Legacy shortcut. If a channel is given, create a proper job; otherwise
    run the old FFmpeg+gTTS path so existing clients keep working.
    """
    if req.channel_id:
        job = create_job(channel_id=req.channel_id, topic=req.topic, idea=req.script)
        if runner:
            await runner.enqueue_and_kick(job["id"])
        return {"status": "queued", "job": job}

    async def _run():
        try:
            result = await render_video(
                topic=req.topic,
                script=req.script or req.topic,
                language=req.language,
                duration_seconds=req.duration_seconds,
                log=broadcast,
            )
            await broadcast({"type": "system", "title": "Video pipeline finished", "message": result.get("video_path", "")})
        except Exception as exc:
            logger.exception("video pipeline")
            await broadcast({"type": "error", "title": "Video failed", "message": str(exc)})

    asyncio.create_task(_run())
    return {"status": "started", "message": "FFmpeg + gTTS pipeline started (Gemini TTS if enabled)."}


@app.websocket("/ws")
async def websocket_logs(websocket: WebSocket):
    if not tokens_match(token_from_ws(websocket)):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    clients.append(websocket)
    await websocket.send_text(
        json.dumps(
            {
                "id": "hello",
                "type": "system",
                "title": "Connected",
                "message": "Connected to GrokPC agent WebSocket.",
                "timestamp": time.strftime("%H:%M:%S"),
            }
        )
    )
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if msg.get("cmd") == "ping":
                await websocket.send_text(
                    json.dumps({"type": "system", "title": "pong", "timestamp": time.strftime("%H:%M:%S")})
                )
    except WebSocketDisconnect:
        if websocket in clients:
            clients.remove(websocket)


if __name__ == "__main__":
    require_token()
    uvicorn.run("main:app", host=HOST, port=PORT, reload=False)
