"""GrokPC FastAPI server — authenticated REST + WebSocket for the mobile control center."""
from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any, Optional

import uvicorn
from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from agent_core import BrowserAgentCore
from auth import cors_origins, require_auth, token_from_ws, tokens_match
from config import AGENT_TOKEN, DRY_RUN, HOST, PORT, require_token
from db import budget_summary, init_db, record_usage
from novnc_proxy import router as novnc_router
from telegram_bridge import TelegramBridge
from video_pipeline import render_video

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("grokpc.main")

clients: list[WebSocket] = []
pending: dict[str, dict[str, Any]] = {}
agent: Optional[BrowserAgentCore] = None
telegram: Optional[TelegramBridge] = None
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


async def resolve_approval(approval_id: str, approved: bool, modified: Optional[str] = None) -> dict[str, Any]:
    item = pending.get(approval_id)
    if not item:
        raise HTTPException(status_code=404, detail="Unknown or expired approval")
    if item.get("resolved"):
        return {"status": "already_resolved", "approval_id": approval_id}
    item["resolved"] = True
    item["approved"] = approved
    if approved and modified is not None:
        if item["type"] == "whatsapp":
            item["message"] = modified
        elif item["type"] == "gmail":
            item["body"] = modified
    await broadcast(
        {
            "type": "approval",
            "title": "Approved" if approved else "Rejected",
            "message": f"{item['type']} {approval_id} {'approved' if approved else 'rejected'}",
            "approvalId": approval_id,
            "approved": approved,
        }
    )
    if not approved:
        pending.pop(approval_id, None)
        record_usage(task_type=item["type"], status="rejected", details=approval_id)
        return {"status": "rejected", "approval_id": approval_id}

    if item["type"] == "whatsapp":
        result = await agent.run_whatsapp_send(item["contact"], item["message"], item.get("attachment_path") or None)
    elif item["type"] == "gmail":
        result = await agent.run_gmail_send(item["recipient"], item.get("subject") or "", item.get("body") or "")
    else:
        result = {"status": "error", "message": f"Unknown type {item['type']}"}
    pending.pop(approval_id, None)
    record_usage(task_type=item["type"], status=result.get("status") or "ok", details=str(result)[:500])
    await broadcast({"type": "action", "title": "Approved task finished", "message": json.dumps(result, default=str)[:500]})
    return {"status": "executed", "approval_id": approval_id, "result": result}


@asynccontextmanager
async def lifespan(app: FastAPI):
    global agent, telegram, _main_loop
    require_token()
    init_db()
    _main_loop = asyncio.get_running_loop()
    agent = BrowserAgentCore(log_callback=broadcast)
    telegram = TelegramBridge(on_decision=resolve_approval)
    await telegram.start()
    yield
    await telegram.stop()
    if agent:
        await agent.close()


app = FastAPI(title="GrokPC Agent", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)
app.include_router(novnc_router)


# ---------------------------------------------------------------------------
# REST
# ---------------------------------------------------------------------------


@app.get("/api/health")
async def get_health(_auth: str = Depends(require_auth)):
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
            cpu = round(float(f.read().split()[0]) * 25, 1)  # rough % of 4 cores
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
    }


def _port_open(host: str, port: int) -> bool:
    import socket

    try:
        with socket.create_connection((host, port), timeout=0.3):
            return True
    except OSError:
        return False


@app.get("/api/budget")
async def get_budget(_auth: str = Depends(require_auth)):
    return budget_summary()


class WhatsAppRequest(BaseModel):
    contact: str
    message: str
    attachment_path: str = ""


class GmailRequest(BaseModel):
    recipient: str
    subject: str = ""
    body: str = ""


class VideoRequest(BaseModel):
    topic: str
    script: str
    language: str = "Hindi"
    duration_seconds: int = 15
    use_google_vids: bool = False


class TaskRequest(BaseModel):
    prompt: str


class ApprovalDecision(BaseModel):
    approval_id: str
    approved: bool
    modified_content: Optional[str] = None


def _queue_approval(kind: str, title: str, recipient: str, content: str, extra: dict[str, Any]) -> dict[str, Any]:
    approval_id = f"{kind}_{uuid.uuid4().hex[:10]}"
    pending[approval_id] = {
        "id": approval_id,
        "type": kind,
        "title": title,
        "recipient": recipient,
        "previewContent": content,
        "createdAt": time.strftime("%H:%M:%S"),
        "resolved": False,
        **extra,
    }
    return {
        "status": "pending_approval",
        "approval_id": approval_id,
        "approval": {k: pending[approval_id][k] for k in ("id", "type", "title", "recipient", "previewContent", "createdAt")},
    }


@app.post("/api/whatsapp/send")
async def send_whatsapp(req: WhatsAppRequest, _auth: str = Depends(require_auth)):
    queued = _queue_approval(
        "whatsapp",
        "WhatsApp dispatch",
        req.contact,
        req.message,
        {"contact": req.contact, "message": req.message, "attachment_path": req.attachment_path},
    )
    await broadcast({"type": "approval", "title": "Approval required", "message": f"WhatsApp to {req.contact}", "pendingApproval": queued["approval"]})
    if telegram:
        await telegram.send_approval(queued["approval_id"], "WhatsApp dispatch", req.contact, req.message)
    return queued


@app.post("/api/gmail/send")
async def send_gmail(req: GmailRequest, _auth: str = Depends(require_auth)):
    queued = _queue_approval(
        "gmail",
        "Gmail send",
        req.recipient,
        req.body,
        {"recipient": req.recipient, "subject": req.subject, "body": req.body},
    )
    await broadcast({"type": "approval", "title": "Approval required", "message": f"Email to {req.recipient}", "pendingApproval": queued["approval"]})
    if telegram:
        await telegram.send_approval(queued["approval_id"], f"Gmail: {req.subject}", req.recipient, req.body)
    return queued


@app.post("/api/approve")
async def approve(req: ApprovalDecision, _auth: str = Depends(require_auth)):
    return await resolve_approval(req.approval_id, req.approved, req.modified_content)


@app.post("/api/vids/generate")
@app.post("/api/video/generate")
async def generate_video(req: VideoRequest, _auth: str = Depends(require_auth)):
    async def _run():
        try:
            if req.use_google_vids:
                task = (
                    f"Open Google Vids (https://docs.google.com/videos) and try to start a video about: {req.topic}. "
                    "If the UI is unavailable, stop and report what you see."
                )
                result = await agent.run_generic_task(task)
                await broadcast({"type": "action", "title": "Google Vids task", "message": str(result.get("result") or result)[:500]})
            result = await render_video(
                topic=req.topic,
                script=req.script,
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


@app.post("/api/task")
async def run_task(req: TaskRequest, _auth: str = Depends(require_auth)):
    prompt = req.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Empty prompt")
    lower = prompt.lower()

    # Route obvious WhatsApp / Gmail / video requests, but still require approval for sends.
    if "whatsapp" in lower or lower.startswith("wa "):
        contact = "Unknown"
        # very light parse: "whatsapp Rahul: hello"
        rest = prompt
        for prefix in ("whatsapp", "wa"):
            if lower.startswith(prefix):
                rest = prompt[len(prefix):].strip(" :,-")
                break
        if ":" in rest:
            contact, _, message = rest.partition(":")
        else:
            contact, message = rest, prompt
        return await send_whatsapp(WhatsAppRequest(contact=contact.strip() or "Unknown", message=message.strip() or prompt), _auth)

    async def _run():
        try:
            result = await agent.run_generic_task(prompt)
            await broadcast({"type": "action", "title": "Agent finished", "message": str(result.get("result") or result)[:800]})
        except Exception as exc:
            logger.exception("task")
            await broadcast({"type": "error", "title": "Task failed", "message": str(exc)})

    asyncio.create_task(_run())
    return {"status": "started", "message": "Vision agent started"}


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
            # Optional client commands over the same socket
            if msg.get("cmd") == "ping":
                await websocket.send_text(json.dumps({"type": "system", "title": "pong", "timestamp": time.strftime("%H:%M:%S")}))
    except WebSocketDisconnect:
        if websocket in clients:
            clients.remove(websocket)


if __name__ == "__main__":
    require_token()
    uvicorn.run("main:app", host=HOST, port=PORT, reload=False)
