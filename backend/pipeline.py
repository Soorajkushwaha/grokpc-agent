"""Phase 1 video pipeline orchestrator.

Order: story+prompts -> voiceover -> visuals (Pollinations stills; optional Grok) -> FFmpeg edit
(CapCut prepared if helper is up). Visuals fall back to the existing title-card path
when not logged in, out of credits, or generation fails. Optional Phase 2 steps
(upload) are inserted only when their flags are on.

The currently working /api/task vision agent is independent: this runner uses
the same BrowserAgentCore lock when it needs the browser (ChatGPT planning),
and otherwise does not touch the Playwright session.
"""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

from config import (
    DRY_RUN,
    FEATURE_AUTOPILOT,
    FEATURE_GOOGLE_VIDS,
    FEATURE_GROK_IMAGINE,
    FEATURE_POLLINATIONS,
    FEATURE_VEO,
    FEATURE_YOUTUBE_UPLOAD,
    TARGET_SCENE_SEC,
    output_dir,
    pipeline_steps,
)
from channels import get_channel
from editors import edit_video
from media_export import copy_final_video
from jobs import (
    append_log,
    cancel_job,
    get_job,
    next_queued,
    pause_job,
    running_job,
    set_step,
    update_job,
)
from planner import plan_story
from video_pipeline import synthesize_voice_safe
from voiceover import load_cues

logger = logging.getLogger("grokpc.pipeline")
LogFn = Callable[[dict[str, Any]], Awaitable[None]]


class PipelineRunner:
    def __init__(self, agent: Any = None, broadcast: Optional[LogFn] = None):
        self.agent = agent
        self.broadcast = broadcast
        self._task: Optional[asyncio.Task] = None
        self._stop = asyncio.Event()
        self._run_lock = asyncio.Lock()
        self.current_job_id: Optional[str] = None

    async def start(self) -> None:
        if self._task is None:
            self._stop.clear()
            self._task = asyncio.create_task(self._loop(), name="pipeline-runner")

    async def stop(self) -> None:
        self._stop.set()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None

    async def enqueue_and_kick(self, job_id: str) -> None:
        # The loop will pick it up; also try immediately if idle.
        if self._run_lock.locked():
            return
        asyncio.create_task(self._maybe_run_one(), name=f"kick-{job_id}")

    async def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                await self._maybe_run_one()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("pipeline loop")
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=2.0)
            except asyncio.TimeoutError:
                pass

    async def _maybe_run_one(self) -> None:
        if self._run_lock.locked():
            return
        if running_job():
            return
        job = next_queued()
        if not job:
            return
        async with self._run_lock:
            await self.run_job(job["id"])

    async def _emit(self, job_id: str, title: str, message: str, step: str = "", level: str = "info") -> None:
        append_log(job_id, level, f"{title}: {message}" if title else message, step=step)
        if self.broadcast:
            await self.broadcast(
                {
                    "type": "action" if level != "error" else "error",
                    "title": title or "Job",
                    "message": message,
                    "jobId": job_id,
                    "step": step,
                }
            )

    def _paused(self, job_id: str) -> Optional[dict[str, Any]]:
        job = get_job(job_id)
        if not job:
            return {"status": "missing"}
        if job["status"] in {"paused", "cancelled"}:
            return job
        return None

    async def run_job(self, job_id: str) -> dict[str, Any]:
        job = get_job(job_id)
        if not job:
            raise KeyError(job_id)
        if job["status"] in {"completed", "cancelled"}:
            return job
        self.current_job_id = job_id
        update_job(job_id, status="running", error="")
        await self._emit(job_id, "Pipeline", f"Start: {job['topic']}", step=job.get("current_step") or "story")

        try:
            result = await self._run_steps(job_id)
            return result
        except Exception as exc:
            logger.exception("job %s failed", job_id)
            await self._emit(job_id, "Pipeline", str(exc), level="error")
            set_step(job_id, (get_job(job_id) or {}).get("current_step") or "story", "failed", str(exc)[:500])
            return update_job(job_id, status="failed", error=str(exc)[:800])
        finally:
            if self.current_job_id == job_id:
                self.current_job_id = None

    async def _run_steps(self, job_id: str) -> dict[str, Any]:
        job = get_job(job_id)
        assert job
        channel = get_channel(job["channel_id"]) or {"id": job["channel_id"], "name": job["channel_id"], "language": "Hindi", "aspect": "16:9"}
        steps = [s["name"] for s in job["steps"]] or pipeline_steps()

        # Resume support: skip steps already successful.
        done = {s["name"] for s in job["steps"] if s["status"] == "success"}

        plan = job.get("plan") or {}
        voice_path = Path(job["voice_path"]) if job.get("voice_path") else None
        media_paths = [Path(p) for p in (job.get("media") or []) if p]
        final_path = Path(job["final_path"]) if job.get("final_path") else None

        for name in steps:
            paused = self._paused(job_id)
            if paused:
                return paused

            if name in done:
                continue

            set_step(job_id, name, "running", "")
            update_job(job_id, status="running", current_step=name)
            await self._emit(job_id, "Step", name, step=name)

            if name == "story":
                result = await plan_story(
                    job["topic"],
                    job.get("idea") or "",
                    channel,
                    agent=self.agent,
                    log=self.broadcast,
                )
                plan = result.get("plan") or {}
                update_job(job_id, plan_json=plan, provider=result.get("planner") or "")
                note = result.get("note") or result.get("planner") or "ok"
                set_step(job_id, "story", "success", f"{result.get('planner')}: {plan.get('title') or ''} {note}"[:500])
                await self._emit(job_id, "Story", plan.get("title") or "planned", step="story")

            elif name == "voiceover":
                script = (plan or {}).get("voiceover_script") or job["topic"]
                lang = channel.get("language") or "Hindi"
                dest = output_dir() / f"voice_{job_id}.mp3"
                segments = []
                for sc in (plan or {}).get("scenes") or []:
                    if not isinstance(sc, dict):
                        continue
                    narr = str(sc.get("narration") or "").strip()
                    if not narr:
                        continue
                    try:
                        min_sec = float(sc.get("duration_sec") or 0)
                    except (TypeError, ValueError):
                        min_sec = 0.0
                    if TARGET_SCENE_SEC and min_sec < TARGET_SCENE_SEC:
                        min_sec = float(TARGET_SCENE_SEC)
                    segments.append({"text": narr, "min_sec": min_sec})
                engine = await synthesize_voice_safe(
                    script, lang, dest, log=self.broadcast, segments=segments or None
                )
                # synthesize may write .wav if mp3 encode failed
                if not dest.is_file():
                    alt = dest.with_suffix(".wav")
                    if alt.is_file():
                        dest = alt
                voice_path = dest
                update_job(job_id, voice_path=str(dest))
                set_step(job_id, "voiceover", "success", f"engine={engine}")
                await self._emit(job_id, "Voiceover", f"{engine} -> {dest.name}", step="voiceover")

            elif name in {"visuals", "generate"}:
                # "visuals" is the current step name; "generate" is kept for older jobs.
                if not (FEATURE_VEO or FEATURE_GROK_IMAGINE or FEATURE_GOOGLE_VIDS or FEATURE_POLLINATIONS):
                    set_step(job_id, name, "skipped", "visuals flags off")
                    continue
                from generators import generate_media

                dest = output_dir() / job_id / "clips"
                try:
                    gen = await generate_media(
                        plan or {},
                        job_id=job_id,
                        dest_dir=dest,
                        agent=self.agent,
                        log=self.broadcast,
                    )
                except Exception as exc:
                    logger.exception("visuals step failed")
                    set_step(job_id, name, "skipped", f"error, falling back: {exc}"[:500])
                    await self._emit(job_id, "Visuals", f"fail, basic visuals use honge: {exc}", step=name)
                    continue
                paths = [Path(p) for p in (gen.get("paths") or []) if p]
                media_paths.extend(paths)
                update_job(
                    job_id,
                    media_json=[str(p) for p in media_paths],
                    provider=gen.get("provider") or "",
                    credit_json=gen.get("credit") or gen.get("auth") or {},
                )
                note = (gen.get("note") or "").strip()
                # Never pause the job for credits / login — always fall through to edit.
                if gen.get("status") in {"ok", "success"} and paths:
                    detail = f"{len(paths)} clips"
                    if gen.get("provider"):
                        detail += f" via {gen['provider']}"
                    if note:
                        detail += f" — {note}"
                    set_step(job_id, name, "success", detail[:500])
                    await self._emit(job_id, "Visuals", detail, step=name)
                else:
                    detail = note or gen.get("status") or "no clips; falling back to basic visuals"
                    set_step(job_id, name, "skipped", detail[:500])
                    await self._emit(job_id, "Visuals", detail, step=name)

            elif name == "edit":
                title = (plan or {}).get("title") or job["topic"]
                duration = 20
                if plan and plan.get("scenes"):
                    duration = max(8, sum(int(s.get("duration_sec") or 8) for s in plan["scenes"]))
                aspect = channel.get("aspect") or "16:9"
                images = [p for p in media_paths if p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".ppm"}]
                clips = [p for p in media_paths if p.suffix.lower() in {".mp4", ".webm", ".mov", ".mkv"}]
                dest = output_dir() / f"final_{job_id}.mp4"
                script = (plan or {}).get("voiceover_script") or job["topic"]
                cues = load_cues(voice_path) if voice_path else []
                edited = await edit_video(
                    title=title,
                    audio_path=voice_path,
                    images=images,
                    clips=clips,
                    duration_seconds=duration,
                    aspect=aspect,
                    log=self.broadcast,
                    dest=dest,
                    cues=cues,
                    script=script,
                )
                final_path = Path(edited["video_path"])
                update_job(job_id, video_path=str(final_path), final_path=str(final_path))
                exports = copy_final_video(final_path, job_id)
                detail = edited.get("editor") or "ffmpeg"
                if edited.get("capcut"):
                    detail += f" capcut={edited['capcut'].get('status')}"
                if exports:
                    detail += f" saved={exports[0]}"
                set_step(job_id, "edit", "success", detail)
                extra = f" also {exports[0]}" if exports else ""
                await self._emit(job_id, "Edit", str(final_path) + extra, step="edit")

            elif name == "upload":
                if not FEATURE_YOUTUBE_UPLOAD:
                    set_step(job_id, "upload", "skipped", "Phase 2 flag off")
                    continue
                from youtube_upload import upload_private

                if not final_path or not final_path.is_file():
                    set_step(job_id, "upload", "failed", "no final video")
                    return update_job(job_id, status="failed", error="upload: no final video")
                up = await upload_private(
                    final_path,
                    title=(plan or {}).get("title") or job["topic"],
                    description=(plan or {}).get("description") or "",
                    tags=(plan or {}).get("tags") or [],
                    channel=channel,
                    agent=self.agent,
                    log=self.broadcast,
                )
                if up.get("status") == "waiting_login":
                    set_step(job_id, "upload", "failed", "YouTube login needed")
                    return update_job(job_id, status="waiting_login", error=up.get("note") or "YouTube login")
                if up.get("status") == "skipped":
                    set_step(job_id, "upload", "skipped", up.get("note") or "")
                elif up.get("status") in {"ok", "success"}:
                    update_job(
                        job_id,
                        youtube_id=str(up.get("youtube_id") or ""),
                        youtube_privacy=up.get("privacy") or "private",
                    )
                    set_step(job_id, "upload", "success", f"private {up.get('youtube_id')}")
                    return update_job(job_id, status="waiting_approval")
                else:
                    set_step(job_id, "upload", "failed", up.get("note") or up.get("status") or "")
                    return update_job(job_id, status="failed", error=f"upload: {up}")

            else:
                set_step(job_id, name, "skipped", "unknown step")

        if final_path and Path(final_path).is_file():
            copy_final_video(final_path, job_id)
        await self._emit(job_id, "Pipeline", "Complete", step="edit")
        return update_job(job_id, status="completed")
