"""Environment configuration for the GrokPC agent backend."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# Load /app/agent/.env when present, else a local .env next to this file.
_DEFAULT_ENV = Path("/app/agent/.env")
_LOCAL_ENV = Path(__file__).resolve().parent / ".env"
if _DEFAULT_ENV.is_file():
    load_dotenv(_DEFAULT_ENV)
elif _LOCAL_ENV.is_file():
    load_dotenv(_LOCAL_ENV)
else:
    load_dotenv()


def _bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _csv(name: str, default: list[str]) -> list[str]:
    raw = os.getenv(name)
    if not raw:
        return list(default)
    return [part.strip().rstrip("/") for part in raw.split(",") if part.strip()]


AGENT_TOKEN = os.getenv("AGENT_TOKEN", "").strip()
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "").strip()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "").strip()

HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "8000"))

CHROME_PROFILE_DIR = os.getenv("CHROME_PROFILE_DIR", "/data/chrome_profile")
GDRIVE_DIR = os.getenv("GDRIVE_DIR", "/mnt/gdrive")
OUTPUT_DIR = os.getenv("OUTPUT_DIR", "")  # auto: gdrive if mounted else /data/outputs
DB_PATH = os.getenv("DB_PATH", "/app/data/agent_tasks.db")

FRONTEND_ORIGINS = _csv(
    "FRONTEND_ORIGINS",
    [
        "https://grokpc-agent.simple-sooraj.workers.dev",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
)

USE_GEMINI_TTS = _bool("USE_GEMINI_TTS", False)
GEMINI_TTS_MODEL = os.getenv("GEMINI_TTS_MODEL", "gemini-3.8-flash-lite-tts")
GEMINI_VISION_MODEL = os.getenv("GEMINI_VISION_MODEL", "gemini-2.5-flash")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-flash")
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")

USD_INR_RATE = float(os.getenv("USD_INR_RATE", "88"))
MONTHLY_CAP_INR = float(os.getenv("MONTHLY_CAP_INR", "1000"))

# Headless Playwright + optional mock LLM for tests / this box.
HEADLESS = _bool("HEADLESS", False)
DRY_RUN = _bool("DRY_RUN", False)
MAX_VISION_STEPS = int(os.getenv("MAX_VISION_STEPS", "12"))

def _mem_total_gb() -> float:
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemTotal:"):
                    return int(line.split()[1]) / 1024 / 1024
    except Exception:
        pass
    return 8.0

# Default on when the box has under ~6 GB RAM (typical 4 GB VPS).
LOW_MEMORY = _bool("LOW_MEMORY", _mem_total_gb() < 6.0)
VIEWPORT_WIDTH = int(os.getenv("VIEWPORT_WIDTH", "1280" if LOW_MEMORY else "1440"))
VIEWPORT_HEIGHT = int(os.getenv("VIEWPORT_HEIGHT", "720" if LOW_MEMORY else "900"))

NOVNC_UPSTREAM = os.getenv("NOVNC_UPSTREAM", "http://127.0.0.1:6080")

# Android / Termux: drive a system Chromium (Playwright has no official Android browsers).
def _is_termux() -> bool:
    return bool(os.getenv("TERMUX_VERSION") or os.getenv("PREFIX", "").endswith("/com.termux/files/usr") or Path("/data/data/com.termux/files").exists())

ANDROID = _bool("ANDROID", _is_termux())
if ANDROID and os.getenv("LOW_MEMORY") is None:
    LOW_MEMORY = True
    if os.getenv("VIEWPORT_WIDTH") is None:
        VIEWPORT_WIDTH = 1280
    if os.getenv("VIEWPORT_HEIGHT") is None:
        VIEWPORT_HEIGHT = 720

CDP_URL = os.getenv("CDP_URL", "").strip()
CHROMIUM_PATH = os.getenv("CHROMIUM_PATH", "").strip()
# Data-saving screenshots (JPEG) — default on Termux / low-memory boxes.
SCREENSHOT_FORMAT = os.getenv("SCREENSHOT_FORMAT", "jpeg" if ANDROID or LOW_MEMORY else "png").strip().lower()
SCREENSHOT_QUALITY = int(os.getenv("SCREENSHOT_QUALITY", "45"))
# Push step screenshots to the phone UI over the websocket. Off on Termux to save 5G.
SCREENSHOT_TO_UI = _bool("SCREENSHOT_TO_UI", not ANDROID)


def output_dir() -> Path:
    if OUTPUT_DIR:
        path = Path(OUTPUT_DIR)
    else:
        gdrive = Path(GDRIVE_DIR)
        if gdrive.is_dir() and os.path.ismount(str(gdrive)):
            path = gdrive / "Vids_Automation"
        else:
            path = Path("/data/outputs")
    path.mkdir(parents=True, exist_ok=True)
    return path


def require_token() -> str:
    if not AGENT_TOKEN:
        raise RuntimeError(
            "AGENT_TOKEN is not set. Create /app/agent/.env (see .env.example)."
        )
    return AGENT_TOKEN
