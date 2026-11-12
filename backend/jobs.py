"""SQLite job store for the video pipeline. Safe to call on an existing DB."""
from __future__ import annotations

import json
import time
import uuid
from typing import Any, Optional

from config import pipeline_steps
from db import connect

JOB_STATUSES = (
    "queued",
    "running",
    "paused",
    "waiting_credits",
    "waiting_approval",
    "waiting_login",
    "completed",
    "failed",
    "cancelled",
)
STEP_STATUSES = ("pending", "running", "success", "failed", "skipped")


def init_tables(conn=None) -> None:
    own = conn is None
    if own:
        conn = connect()
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            channel_id TEXT,
            topic TEXT,
            idea TEXT,
            status TEXT,
            current_step TEXT,
            plan_json TEXT,
            voice_path TEXT,
            media_json TEXT,
            video_path TEXT,
            final_path TEXT,
            youtube_id TEXT,
            youtube_privacy TEXT,
            provider TEXT,
            credit_json TEXT,
            error TEXT,
            autopilot INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS job_steps (
            id TEXT PRIMARY KEY,
            job_id TEXT,
            name TEXT,
            status TEXT,
            detail TEXT,
            started_at TEXT,
            finished_at TEXT,
            cost_inr REAL DEFAULT 0,
            seq INTEGER DEFAULT 0
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS job_logs (
            id TEXT PRIMARY KEY,
            job_id TEXT,
            step TEXT,
            level TEXT,
            message TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS credit_checks (
            id TEXT PRIMARY KEY,
            job_id TEXT,
            provider TEXT,
            raw TEXT,
            has_balance INTEGER,
            decided TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_job_logs_job ON job_logs(job_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_job_steps_job ON job_steps(job_id)")
    conn.commit()
    if own:
        conn.close()


def _now() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


def _new_id(prefix: str = "job") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def create_job(
    *,
    channel_id: str,
    topic: str,
    idea: str = "",
    autopilot: bool = False,
    steps: Optional[list[str]] = None,
) -> dict[str, Any]:
    job_id = _new_id("job")
    steps = list(steps or pipeline_steps())
    conn = connect()
    conn.execute(
        """
        INSERT INTO jobs (
            id, channel_id, topic, idea, status, current_step,
            plan_json, media_json, autopilot, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'queued', ?, 'null', '[]', ?, ?, ?)
        """,
        (job_id, channel_id, topic, idea, steps[0] if steps else "story", int(autopilot), _now(), _now()),
    )
    for i, name in enumerate(steps):
        conn.execute(
            """
            INSERT INTO job_steps (id, job_id, name, status, detail, seq)
            VALUES (?, ?, ?, 'pending', '', ?)
            """,
            (_new_id("step"), job_id, name, i),
        )
    conn.commit()
    conn.close()
    append_log(job_id, "system", f"Job created for channel={channel_id} topic={topic!r}", step=steps[0] if steps else "")
    return get_job(job_id)


def _row_job(row, steps=None, logs=None) -> dict[str, Any]:
    def _json(raw, default):
        if not raw:
            return default
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return default

    return {
        "id": row["id"],
        "channel_id": row["channel_id"],
        "topic": row["topic"],
        "idea": row["idea"] or "",
        "status": row["status"],
        "current_step": row["current_step"],
        "plan": _json(row["plan_json"], None),
        "voice_path": row["voice_path"] or "",
        "media": _json(row["media_json"], []),
        "video_path": row["video_path"] or "",
        "final_path": row["final_path"] or "",
        "youtube_id": row["youtube_id"] or "",
        "youtube_privacy": row["youtube_privacy"] or "",
        "provider": row["provider"] or "",
        "credit": _json(row["credit_json"], None),
        "error": row["error"] or "",
        "autopilot": bool(row["autopilot"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "steps": steps if steps is not None else list_steps(row["id"]),
        "recent_logs": logs if logs is not None else list_logs(row["id"], limit=8),
    }


def get_job(job_id: str, with_logs: bool = False, log_limit: int = 50) -> Optional[dict[str, Any]]:
    conn = connect()
    row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    conn.close()
    if not row:
        return None
    logs = list_logs(job_id, limit=log_limit) if with_logs else None
    return _row_job(row, logs=logs)


def list_jobs(limit: int = 50, status: Optional[str] = None, channel_id: Optional[str] = None) -> list[dict[str, Any]]:
    conn = connect()
    sql = "SELECT * FROM jobs"
    args: list[Any] = []
    where = []
    if status:
        where.append("status = ?")
        args.append(status)
    if channel_id:
        where.append("channel_id = ?")
        args.append(channel_id)
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY created_at DESC LIMIT ?"
    args.append(int(limit))
    rows = conn.execute(sql, args).fetchall()
    # batch steps
    ids = [r["id"] for r in rows]
    steps_by: dict[str, list] = {i: [] for i in ids}
    if ids:
        placeholders = ",".join("?" * len(ids))
        for s in conn.execute(
            f"SELECT * FROM job_steps WHERE job_id IN ({placeholders}) ORDER BY seq ASC",
            ids,
        ):
            steps_by[s["job_id"]].append(_row_step(s))
    conn.close()
    return [_row_job(r, steps=steps_by.get(r["id"], [])) for r in rows]


def _row_step(s) -> dict[str, Any]:
    return {
        "id": s["id"],
        "name": s["name"],
        "status": s["status"],
        "detail": s["detail"] or "",
        "started_at": s["started_at"] or "",
        "finished_at": s["finished_at"] or "",
        "cost_inr": s["cost_inr"] or 0,
        "seq": s["seq"],
    }


def list_steps(job_id: str) -> list[dict[str, Any]]:
    conn = connect()
    rows = conn.execute(
        "SELECT * FROM job_steps WHERE job_id = ? ORDER BY seq ASC", (job_id,)
    ).fetchall()
    conn.close()
    return [_row_step(r) for r in rows]


def list_logs(job_id: str, limit: int = 100) -> list[dict[str, Any]]:
    conn = connect()
    rows = conn.execute(
        "SELECT * FROM job_logs WHERE job_id = ? ORDER BY created_at DESC LIMIT ?",
        (job_id, int(limit)),
    ).fetchall()
    conn.close()
    return [
        {
            "id": r["id"],
            "step": r["step"] or "",
            "level": r["level"] or "info",
            "message": r["message"] or "",
            "created_at": r["created_at"],
        }
        for r in rows
    ]


def append_log(job_id: str, level: str, message: str, step: str = "") -> None:
    conn = connect()
    conn.execute(
        "INSERT INTO job_logs (id, job_id, step, level, message, created_at) VALUES (?,?,?,?,?,?)",
        (_new_id("log"), job_id, step, level, message[:4000], _now()),
    )
    conn.commit()
    conn.close()


def update_job(job_id: str, **fields: Any) -> dict[str, Any]:
    allowed = {
        "status",
        "current_step",
        "plan_json",
        "voice_path",
        "media_json",
        "video_path",
        "final_path",
        "youtube_id",
        "youtube_privacy",
        "provider",
        "credit_json",
        "error",
        "channel_id",
        "topic",
        "idea",
    }
    sets = []
    args: list[Any] = []
    for k, v in fields.items():
        if k not in allowed:
            continue
        if k in {"plan_json", "media_json", "credit_json"} and not isinstance(v, str):
            v = json.dumps(v, default=str)
        sets.append(f"{k} = ?")
        args.append(v)
    if not sets:
        return get_job(job_id)  # type: ignore
    sets.append("updated_at = ?")
    args.append(_now())
    args.append(job_id)
    conn = connect()
    conn.execute(f"UPDATE jobs SET {', '.join(sets)} WHERE id = ?", args)
    conn.commit()
    conn.close()
    job = get_job(job_id)
    if not job:
        raise KeyError(job_id)
    return job


def set_step(job_id: str, name: str, status: str, detail: str = "", cost_inr: float = 0.0) -> None:
    conn = connect()
    now = _now()
    row = conn.execute(
        "SELECT id, status FROM job_steps WHERE job_id = ? AND name = ?", (job_id, name)
    ).fetchone()
    if not row:
        conn.close()
        return
    fields = {"status": status, "detail": (detail or "")[:2000]}
    if status == "running" and row["status"] != "running":
        fields["started_at"] = now
    if status in {"success", "failed", "skipped"}:
        fields["finished_at"] = now
    if cost_inr:
        fields["cost_inr"] = cost_inr
    sets = ", ".join(f"{k} = ?" for k in fields)
    conn.execute(
        f"UPDATE job_steps SET {sets} WHERE id = ?",
        [*fields.values(), row["id"]],
    )
    conn.execute("UPDATE jobs SET current_step = ?, updated_at = ? WHERE id = ?", (name, now, job_id))
    conn.commit()
    conn.close()


def record_credit_check(job_id: str, provider: str, raw: Any, has_balance: bool, decided: str) -> None:
    conn = connect()
    conn.execute(
        """
        INSERT INTO credit_checks (id, job_id, provider, raw, has_balance, decided, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            _new_id("cr"),
            job_id,
            provider,
            json.dumps(raw, default=str)[:4000] if not isinstance(raw, str) else raw[:4000],
            int(has_balance),
            decided,
            _now(),
        ),
    )
    conn.commit()
    conn.close()


def next_queued() -> Optional[dict[str, Any]]:
    conn = connect()
    # Prefer manually queued jobs (autopilot=0) then autopilot.
    row = conn.execute(
        """
        SELECT * FROM jobs
        WHERE status = 'queued'
        ORDER BY autopilot ASC, created_at ASC
        LIMIT 1
        """
    ).fetchone()
    conn.close()
    return _row_job(row) if row else None


def running_job() -> Optional[dict[str, Any]]:
    conn = connect()
    row = conn.execute(
        "SELECT * FROM jobs WHERE status = 'running' ORDER BY updated_at DESC LIMIT 1"
    ).fetchone()
    conn.close()
    return _row_job(row) if row else None


def pause_job(job_id: str, reason: str = "paused by user") -> dict[str, Any]:
    job = get_job(job_id)
    if not job:
        raise KeyError(job_id)
    if job["status"] not in {"running", "queued", "waiting_login", "waiting_credits"}:
        return job
    append_log(job_id, "system", reason, step=job.get("current_step") or "")
    return update_job(job_id, status="paused", error=reason)


def resume_job(job_id: str) -> dict[str, Any]:
    job = get_job(job_id)
    if not job:
        raise KeyError(job_id)
    if job["status"] not in {"paused", "waiting_login", "waiting_credits", "failed"}:
        return job
    append_log(job_id, "system", f"Resumed from {job['status']}", step=job.get("current_step") or "")
    return update_job(job_id, status="queued", error="")


def cancel_job(job_id: str) -> dict[str, Any]:
    job = get_job(job_id)
    if not job:
        raise KeyError(job_id)
    append_log(job_id, "system", "Cancelled", step=job.get("current_step") or "")
    return update_job(job_id, status="cancelled", error="cancelled")
