"""Environment configuration for the GrokPC video-production agent."""
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
# Legacy / unused in Phase 1 (messaging removed). Kept so existing .env files still load.
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


# Default on when the box has under ~6 GB RAM (typical 4 GB VPS / capped WSL).
LOW_MEMORY = _bool("LOW_MEMORY", _mem_total_gb() < 6.0)
VIEWPORT_WIDTH = int(os.getenv("VIEWPORT_WIDTH", "1280" if LOW_MEMORY else "1440"))
VIEWPORT_HEIGHT = int(os.getenv("VIEWPORT_HEIGHT", "720" if LOW_MEMORY else "900"))

NOVNC_UPSTREAM = os.getenv("NOVNC_UPSTREAM", "http://127.0.0.1:6080")


# Android / Termux: drive a system Chromium (Playwright has no official Android browsers).
def _is_termux() -> bool:
    return bool(
        os.getenv("TERMUX_VERSION")
        or os.getenv("PREFIX", "").endswith("/com.termux/files/usr")
        or Path("/data/data/com.termux/files").exists()
    )


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

# ---------------------------------------------------------------------------
# Phase flags. Phase 2 defaults OFF so a laptop restart on new code keeps
# the current working path (browser vision + FFmpeg pipeline) without
# touching live sites we have not tested.
# ---------------------------------------------------------------------------
# Phase 1 (on): ChatGPT/DeepSeek planning, voiceover, FFmpeg edit, CapCut helper, jobs API.
FEATURE_CAPCUT = _bool("FEATURE_CAPCUT", True)
FEATURE_CHATGPT_PLANNER = _bool("FEATURE_CHATGPT_PLANNER", True)
# Phase 2 (off until tested): paid/web video gen, YouTube, autopilot, credit scrape, AI Studio voice.
FEATURE_VEO = _bool("FEATURE_VEO", False)
FEATURE_GROK_IMAGINE = _bool("FEATURE_GROK_IMAGINE", False)
FEATURE_YOUTUBE_UPLOAD = _bool("FEATURE_YOUTUBE_UPLOAD", False)
FEATURE_AUTOPILOT = _bool("FEATURE_AUTOPILOT", False)
FEATURE_CREDIT_CHECK = _bool("FEATURE_CREDIT_CHECK", False)
FEATURE_AISTUDIO_VOICE = _bool("FEATURE_AISTUDIO_VOICE", False)

# Windows desktop helper (Phase 1, optional). WSL2 localhost forwarding reaches
# a Windows process bound to 127.0.0.1 (already enabled in windows/install.ps1).
WINDOWS_HELPER_URL = os.getenv("WINDOWS_HELPER_URL", "http://127.0.0.1:8765").rstrip("/")
WINDOWS_HELPER_TOKEN = os.getenv("WINDOWS_HELPER_TOKEN", "").strip() or AGENT_TOKEN
WINDOWS_HELPER_PORT = int(os.getenv("WINDOWS_HELPER_PORT", "8765"))
# Folder on the Windows drive so CapCut can see media. Empty = auto-detect /mnt/c/Users/*/Videos/GrokPC
WINDOWS_MEDIA_DIR = os.getenv("WINDOWS_MEDIA_DIR", "").strip()

# Autopilot knobs (only consulted when FEATURE_AUTOPILOT=1).
AUTOPILOT_ENABLED = _bool("AUTOPILOT_ENABLED", False)
IDLE_SECONDS = int(os.getenv("IDLE_SECONDS", "900"))  # 15 min
QUIET_HOURS = os.getenv("QUIET_HOURS", "23:00-07:00").strip()
DAILY_VIDEO_CAP = int(os.getenv("DAILY_VIDEO_CAP", "3"))
DAILY_SPEND_CAP_INR = float(os.getenv("DAILY_SPEND_CAP_INR", "40"))

# Preferred planner: "chatgpt" (web, needs one-time login) then DeepSeek text fallback.
PLANNER = os.getenv("PLANNER", "chatgpt").strip().lower() or "chatgpt"

CHANNELS_PATH = os.getenv("CHANNELS_PATH", "").strip()
STYLE_PROFILE_PATH = os.getenv("STYLE_PROFILE_PATH", "").strip()
RUNTIME_SETTINGS_PATH = os.getenv("RUNTIME_SETTINGS_PATH", "").strip()


def data_dir() -> Path:
    path = Path(DB_PATH).expanduser().resolve().parent
    path.mkdir(parents=True, exist_ok=True)
    return path


def channels_path() -> Path:
    return Path(CHANNELS_PATH) if CHANNELS_PATH else data_dir() / "channels.json"


def style_profile_path() -> Path:
    return Path(STYLE_PROFILE_PATH) if STYLE_PROFILE_PATH else data_dir() / "style_profile.json"


def runtime_settings_path() -> Path:
    return Path(RUNTIME_SETTINGS_PATH) if RUNTIME_SETTINGS_PATH else data_dir() / "runtime_settings.json"


def feature_flags() -> dict[str, bool]:
    return {
        "planning": True,
        "voiceover": True,
        "ffmpeg_edit": True,
        "capcut": FEATURE_CAPCUT,
        "chatgpt_planner": FEATURE_CHATGPT_PLANNER,
        "veo": FEATURE_VEO,
        "grok_imagine": FEATURE_GROK_IMAGINE,
        "youtube_upload": FEATURE_YOUTUBE_UPLOAD,
        "autopilot": FEATURE_AUTOPILOT,
        "credit_check": FEATURE_CREDIT_CHECK,
        "aistudio_voice": FEATURE_AISTUDIO_VOICE,
    }


def pipeline_steps() -> list[str]:
    """Ordered job steps for the currently enabled feature set."""
    steps = ["story", "voiceover"]
    if FEATURE_VEO or FEATURE_GROK_IMAGINE:
        steps.append("generate")
    steps.append("edit")
    if FEATURE_YOUTUBE_UPLOAD:
        steps.append("upload")
    return steps


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


def windows_media_dir() -> Path:
    """A Windows-visible folder for CapCut imports. Falls back to output_dir()."""
    if WINDOWS_MEDIA_DIR:
        path = Path(WINDOWS_MEDIA_DIR)
        path.mkdir(parents=True, exist_ok=True)
        return path
    users = Path("/mnt/c/Users")
    if users.is_dir():
        skip = {"public", "default", "default user", "all users", "desktop.ini"}
        for user in sorted(users.iterdir()):
            if not user.is_dir() or user.name.lower() in skip or user.name.startswith("."):
                continue
            videos = user / "Videos"
            if videos.is_dir() or user.is_dir():
                path = (videos if videos.is_dir() else user) / "GrokPC"
                try:
                    path.mkdir(parents=True, exist_ok=True)
                    return path
                except OSError:
                    continue
    return output_dir()


def require_token() -> str:
    if not AGENT_TOKEN:
        raise RuntimeError(
            "AGENT_TOKEN is not set. Create /app/agent/.env (see .env.example)."
        )
    return AGENT_TOKEN
