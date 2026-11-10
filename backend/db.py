"""SQLite task + cost tracking."""
from __future__ import annotations

import os
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any, Optional

from config import DB_PATH, MONTHLY_CAP_INR, USD_INR_RATE

# Official-ish USD per 1M tokens (peak, cache miss) — see ORACLE_STEPS / README.
DEEPSEEK_FLASH_INPUT_USD_PER_M = 0.30
DEEPSEEK_FLASH_OUTPUT_USD_PER_M = 1.20
GEMINI_FLASH_INPUT_USD_PER_M = 0.30  # approx paid 2.5/3.x flash; usage still recorded raw
GEMINI_FLASH_OUTPUT_USD_PER_M = 2.50
GEMINI_TTS_INPUT_USD_PER_M = 0.50
GEMINI_TTS_OUTPUT_USD_PER_M = 9.00


def connect() -> sqlite3.Connection:
    path = Path(DB_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    conn = connect()
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS task_logs (
            id TEXT PRIMARY KEY,
            task_type TEXT,
            status TEXT,
            details TEXT,
            tokens_in INTEGER DEFAULT 0,
            tokens_out INTEGER DEFAULT 0,
            provider TEXT,
            model TEXT,
            cost_usd REAL DEFAULT 0.0,
            cost_inr REAL DEFAULT 0.0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    # Migrate older schemas quietly
    cols = {row[1] for row in cur.execute("PRAGMA table_info(task_logs)")}
    for name, decl in {
        "tokens_in": "INTEGER DEFAULT 0",
        "tokens_out": "INTEGER DEFAULT 0",
        "provider": "TEXT",
        "model": "TEXT",
        "cost_usd": "REAL DEFAULT 0.0",
        "cost_inr": "REAL DEFAULT 0.0",
    }.items():
        if name not in cols:
            cur.execute(f"ALTER TABLE task_logs ADD COLUMN {name} {decl}")
    conn.commit()
    conn.close()


def estimate_cost_usd(provider: str, tokens_in: int, tokens_out: int, kind: str = "chat") -> float:
    if provider == "deepseek":
        inp, out = DEEPSEEK_FLASH_INPUT_USD_PER_M, DEEPSEEK_FLASH_OUTPUT_USD_PER_M
    elif provider == "gemini" and kind == "tts":
        inp, out = GEMINI_TTS_INPUT_USD_PER_M, GEMINI_TTS_OUTPUT_USD_PER_M
    else:
        inp, out = GEMINI_FLASH_INPUT_USD_PER_M, GEMINI_FLASH_OUTPUT_USD_PER_M
    return (tokens_in / 1_000_000) * inp + (tokens_out / 1_000_000) * out


def record_usage(
    *,
    task_type: str,
    status: str,
    details: str = "",
    tokens_in: int = 0,
    tokens_out: int = 0,
    provider: str = "",
    model: str = "",
    kind: str = "chat",
    cost_usd: Optional[float] = None,
) -> dict[str, Any]:
    if cost_usd is None:
        cost_usd = estimate_cost_usd(provider, tokens_in, tokens_out, kind)
    cost_inr = round(cost_usd * USD_INR_RATE, 4)
    row_id = f"{int(time.time()*1000)}-{uuid.uuid4().hex[:8]}"
    conn = connect()
    conn.execute(
        """
        INSERT INTO task_logs (
            id, task_type, status, details, tokens_in, tokens_out,
            provider, model, cost_usd, cost_inr
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (row_id, task_type, status, details, tokens_in, tokens_out, provider, model, cost_usd, cost_inr),
    )
    conn.commit()
    conn.close()
    return {
        "id": row_id,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "provider": provider,
        "model": model,
        "cost_usd": round(cost_usd, 6),
        "cost_inr": cost_inr,
    }


def budget_summary() -> dict[str, Any]:
    conn = connect()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT
            COALESCE(SUM(tokens_in), 0),
            COALESCE(SUM(tokens_out), 0),
            COALESCE(SUM(cost_usd), 0),
            COALESCE(SUM(cost_inr), 0),
            COALESCE(SUM(CASE WHEN provider = 'deepseek' THEN tokens_in + tokens_out ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN provider = 'deepseek' THEN cost_inr ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN provider = 'gemini' THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN provider = 'gemini' THEN cost_inr ELSE 0 END), 0)
        FROM task_logs
        WHERE created_at >= date('now', 'start of month')
        """
    )
    row = cur.fetchone()
    conn.close()
    tokens_in, tokens_out, cost_usd, cost_inr, ds_tokens, ds_inr, gem_calls, gem_inr = row
    return {
        "monthlyCapInr": MONTHLY_CAP_INR,
        "currentSpendInr": round(cost_inr, 2),
        "currentSpendUsd": round(cost_usd, 4),
        "usdInrRate": USD_INR_RATE,
        "tokensIn": int(tokens_in),
        "tokensOut": int(tokens_out),
        "deepseekTokensUsed": int(ds_tokens),
        "deepseekCostInr": round(ds_inr, 2),
        "geminiCallsUsed": int(gem_calls),
        "geminiCostInr": round(gem_inr, 2),
        "oracleCloudCostInr": 0.0,
        "hardLimitPauseEnabled": True,
        "overBudget": cost_inr >= MONTHLY_CAP_INR,
    }
