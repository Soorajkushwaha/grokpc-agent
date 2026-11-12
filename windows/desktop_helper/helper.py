"""GrokPC Windows desktop helper.

Runs in the user's interactive Windows session (non-admin scheduled task at
logon). Bound to 127.0.0.1 only. WSL reaches it via localhost forwarding.
Bearer token must match the agent (usually the same AGENT_TOKEN).

This process can:
  - report user idle time (GetLastInputInfo)
  - take screenshots and send mouse/keyboard (pyautogui / mss)
  - launch CapCut (or Shotcut / Kdenlive / a raw path)
  - copy media into Videos\\GrokPC\\import and open that folder

CapCut has no API. Importing into a timeline is a vision-loop job, and it
will break when CapCut's UI changes. This helper only does the reliable bits.
"""
from __future__ import annotations

import ctypes
import logging
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Response
from fastapi.responses import JSONResponse, Response as FastResponse
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("grokpc.helper")

HOST = os.environ.get("GROKPC_HELPER_HOST", "127.0.0.1")
PORT = int(os.environ.get("GROKPC_HELPER_PORT", "8765"))
TOKEN = (os.environ.get("GROKPC_HELPER_TOKEN") or os.environ.get("AGENT_TOKEN") or "").strip()
IMPORT_DIR = Path(os.environ.get("GROKPC_IMPORT_DIR") or "").expanduser()

IS_WIN = sys.platform == "win32"


def _load_dotenv() -> None:
    global TOKEN, IMPORT_DIR
    candidates = [
        Path(os.environ.get("GROKPC_HELPER_ENV") or ""),
        Path(os.environ.get("LOCALAPPDATA") or "") / "GrokPC" / "helper.env",
        Path(__file__).resolve().parent / "helper.env",
    ]
    for path in candidates:
        if not path or not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k, v = k.strip(), v.strip().strip('"').strip("'")
            os.environ.setdefault(k, v)
        break
    TOKEN = (os.environ.get("GROKPC_HELPER_TOKEN") or os.environ.get("AGENT_TOKEN") or TOKEN).strip()
    if not IMPORT_DIR:
        home = Path(os.environ.get("USERPROFILE") or Path.home())
        IMPORT_DIR = home / "Videos" / "GrokPC" / "import"


_load_dotenv()


def _dpi_aware() -> None:
    if not IS_WIN:
        return
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)  # PER_MONITOR_AWARE
    except Exception:
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass


_dpi_aware()


def idle_seconds() -> float:
    if not IS_WIN:
        return 10**9

    class LASTINPUTINFO(ctypes.Structure):
        _fields_ = [("cbSize", ctypes.c_uint), ("dwTime", ctypes.c_uint)]

    info = LASTINPUTINFO()
    info.cbSize = ctypes.sizeof(info)
    if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(info)):
        return 0.0
    millis = ctypes.windll.kernel32.GetTickCount() - info.dwTime
    return max(0.0, millis / 1000.0)


def _require_auth(authorization: Optional[str] = Header(None), token: Optional[str] = Query(None)) -> str:
    if not TOKEN:
        raise HTTPException(status_code=500, detail="Helper token is not configured")
    provided = ""
    if authorization:
        parts = authorization.split(None, 1)
        provided = parts[1].strip() if len(parts) == 2 and parts[0].lower() == "bearer" else authorization.strip()
    elif token:
        provided = token.strip()
    import secrets

    if not provided or not secrets.compare_digest(provided, TOKEN):
        raise HTTPException(status_code=401, detail="Invalid or missing bearer token")
    return TOKEN


def _to_windows_path(p: str) -> Path:
    s = (p or "").strip().strip('"')
    if s.startswith("/mnt/") and len(s) > 6 and s[5].isalpha() and s[6] == "/":
        s = f"{s[5].upper()}:\\" + s[7:].replace("/", "\\")
    return Path(s)


def _find_capcut() -> Optional[Path]:
    env = os.environ.get("CAPCUT_PATH")
    if env and Path(env).is_file():
        return Path(env)
    local = Path(os.environ.get("LOCALAPPDATA") or "")
    program = Path(os.environ.get("ProgramFiles") or r"C:\Program Files")
    program86 = Path(os.environ.get("ProgramFiles(x86)") or r"C:\Program Files (x86)")
    candidates = [
        local / "CapCut" / "Apps" / "CapCut.exe",
        local / "CapCut" / "CapCut.exe",
        program / "CapCut" / "CapCut.exe",
        program86 / "CapCut" / "CapCut.exe",
    ]
    # CapCut often nests a versioned folder under Apps.
    apps = local / "CapCut" / "Apps"
    if apps.is_dir():
        for child in sorted(apps.rglob("CapCut.exe")):
            candidates.append(child)
    for c in candidates:
        if c.is_file():
            return c
    # Last try: Start Menu shortcut / where
    if IS_WIN:
        found = shutil.which("CapCut") or shutil.which("capcut")
        if found:
            return Path(found)
    return None


def _find_app(name: str) -> Optional[Path]:
    key = (name or "").strip().lower()
    aliases = {
        "capcut": _find_capcut,
        "shotcut": lambda: next((Path(p) for p in [
            Path(os.environ.get("ProgramFiles") or r"C:\Program Files") / "Shotcut" / "shotcut.exe",
            Path(shutil.which("shotcut") or ""),
        ] if p and p.is_file()), None),
        "kdenlive": lambda: next((Path(p) for p in [
            Path(os.environ.get("ProgramFiles") or r"C:\Program Files") / "kdenlive" / "bin" / "kdenlive.exe",
            Path(shutil.which("kdenlive") or ""),
        ] if p and p.is_file()), None),
    }
    if key in aliases:
        return aliases[key]()
    raw = Path(name)
    if raw.is_file():
        return raw
    found = shutil.which(name)
    return Path(found) if found else None


def _foreground_title() -> str:
    if not IS_WIN:
        return ""
    user32 = ctypes.windll.user32
    hwnd = user32.GetForegroundWindow()
    length = user32.GetWindowTextLengthW(hwnd)
    buf = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(hwnd, buf, length + 1)
    return buf.value or ""


def _screen_size() -> dict[str, int]:
    if IS_WIN:
        try:
            user32 = ctypes.windll.user32
            return {"width": int(user32.GetSystemMetrics(0)), "height": int(user32.GetSystemMetrics(1))}
        except Exception:
            pass
    return {"width": 0, "height": 0}


def _pg():
    """Lazy-import pyautogui so Linux unit tests don't need it."""
    import pyautogui

    pyautogui.FAILSAFE = True
    pyautogui.PAUSE = 0.05
    return pyautogui


app = FastAPI(title="GrokPC Windows Helper")


@app.get("/health")
def health(_auth: str = Depends(_require_auth)) -> dict[str, Any]:
    cap = _find_capcut()
    return {
        "ok": True,
        "status": "ok",
        "platform": sys.platform,
        "screen": _screen_size(),
        "idle_seconds": idle_seconds(),
        "foreground_title": _foreground_title(),
        "capcut_installed": bool(cap),
        "capcut_path": str(cap) if cap else "",
        "import_dir": str(IMPORT_DIR),
    }


@app.get("/idle")
def get_idle(_auth: str = Depends(_require_auth)) -> dict[str, Any]:
    secs = idle_seconds()
    return {"idle_seconds": secs, "user_active": secs < 2.0}


@app.get("/apps")
def apps(_auth: str = Depends(_require_auth)) -> dict[str, Any]:
    return {
        "capcut": str(_find_capcut() or ""),
        "shotcut": str(_find_app("shotcut") or ""),
        "kdenlive": str(_find_app("kdenlive") or ""),
    }


@app.get("/screenshot")
def screenshot(fmt: str = Query("png", alias="format"), _auth: str = Depends(_require_auth)):
    if not IS_WIN:
        # 1x1 transparent PNG so tests can hit the route without mss.
        import base64

        png = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        )
        return FastResponse(png, media_type="image/png")
    try:
        import mss
        from PIL import Image
        import io

        with mss.mss() as sct:
            mon = sct.monitors[1] if len(sct.monitors) > 1 else sct.monitors[0]
            raw = sct.grab(mon)
            img = Image.frombytes("RGB", raw.size, raw.bgra, "raw", "BGRX")
        buf = io.BytesIO()
        if fmt.lower() in {"jpg", "jpeg"}:
            img.save(buf, format="JPEG", quality=70)
            mime = "image/jpeg"
        else:
            img.save(buf, format="PNG")
            mime = "image/png"
        return FastResponse(buf.getvalue(), media_type=mime)
    except Exception as exc:
        logger.exception("screenshot")
        raise HTTPException(status_code=500, detail=str(exc)[:300]) from exc


class ClickIn(BaseModel):
    x: int
    y: int
    button: str = "left"


class TypeIn(BaseModel):
    text: str


class PressIn(BaseModel):
    key: str


class ScrollIn(BaseModel):
    amount: int = 400
    x: int = 0
    y: int = 0


class LaunchIn(BaseModel):
    app: str
    args: list[str] = []


class ImportIn(BaseModel):
    paths: list[str]
    open_folder: bool = True


class FocusIn(BaseModel):
    title_contains: str


@app.post("/click")
def click(req: ClickIn, _auth: str = Depends(_require_auth)) -> dict[str, Any]:
    if not IS_WIN:
        return {"ok": True, "simulated": True, "x": req.x, "y": req.y}
    pg = _pg()
    button = req.button if req.button in {"left", "right", "middle"} else "left"
    pg.click(req.x, req.y, button=button)
    return {"ok": True, "x": req.x, "y": req.y}


@app.post("/type")
def type_text(req: TypeIn, _auth: str = Depends(_require_auth)) -> dict[str, Any]:
    if not IS_WIN:
        return {"ok": True, "simulated": True, "chars": len(req.text or "")}
    _pg().typewrite(req.text or "", interval=0.02)
    return {"ok": True, "chars": len(req.text or "")}


def _normalize_hotkey(key: str) -> list[str]:
    parts = [p.strip().lower() for p in (key or "enter").replace("-", "+").split("+") if p.strip()]
    aliases = {
        "ctrl": "ctrl",
        "control": "ctrl",
        "alt": "alt",
        "shift": "shift",
        "enter": "enter",
        "return": "enter",
        "esc": "esc",
        "escape": "esc",
        "tab": "tab",
        "win": "win",
        "cmd": "win",
        "super": "win",
        "del": "delete",
        "delete": "delete",
        "backspace": "backspace",
        "space": "space",
        "up": "up",
        "down": "down",
        "left": "left",
        "right": "right",
    }
    return [aliases.get(p, p) for p in parts] or ["enter"]


@app.post("/press")
def press(req: PressIn, _auth: str = Depends(_require_auth)) -> dict[str, Any]:
    keys = _normalize_hotkey(req.key)
    if not IS_WIN:
        return {"ok": True, "simulated": True, "keys": keys}
    pg = _pg()
    if len(keys) == 1:
        pg.press(keys[0])
    else:
        pg.hotkey(*keys)
    return {"ok": True, "keys": keys}


@app.post("/scroll")
def scroll(req: ScrollIn, _auth: str = Depends(_require_auth)) -> dict[str, Any]:
    # pyautogui scroll: positive is up. Our vision loop uses positive = down (browser wheel).
    clicks = int(-req.amount / 40) or (-1 if req.amount > 0 else 1)
    if not IS_WIN:
        return {"ok": True, "simulated": True, "clicks": clicks}
    pg = _pg()
    if req.x or req.y:
        pg.moveTo(req.x, req.y)
    pg.scroll(clicks)
    return {"ok": True, "clicks": clicks}


@app.post("/launch")
def launch(req: LaunchIn, _auth: str = Depends(_require_auth)) -> dict[str, Any]:
    path = _find_app(req.app)
    if path is None and Path(req.app).is_file():
        path = Path(req.app)
    if path is None:
        raise HTTPException(
            status_code=404,
            detail=f"App not found: {req.app}. Install CapCut on Windows, or pass a full path.",
        )
    if not IS_WIN:
        return {"ok": True, "simulated": True, "path": str(path)}
    try:
        subprocess.Popen([str(path), *list(req.args or [])], close_fds=True)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=str(exc)[:300]) from exc
    return {"ok": True, "path": str(path)}


@app.post("/import_media")
def import_media(req: ImportIn, _auth: str = Depends(_require_auth)) -> dict[str, Any]:
    IMPORT_DIR.mkdir(parents=True, exist_ok=True)
    copied = []
    errors = []
    for raw in req.paths or []:
        src = _to_windows_path(raw)
        if not src.is_file():
            errors.append(f"missing: {src}")
            continue
        dest = IMPORT_DIR / src.name
        try:
            if src.resolve() != dest.resolve():
                shutil.copy2(src, dest)
            copied.append(str(dest))
        except OSError as exc:
            errors.append(f"{src}: {exc}")
    opened = False
    if req.open_folder and IS_WIN:
        try:
            os.startfile(str(IMPORT_DIR))  # type: ignore[attr-defined]
            opened = True
        except OSError as exc:
            errors.append(f"open_folder: {exc}")
    return {
        "ok": True,
        "import_dir": str(IMPORT_DIR),
        "copied": copied,
        "errors": errors,
        "opened_folder": opened,
        "note": (
            "Files are in the import folder. CapCut has no API — use File > Import "
            "(often Ctrl+I) or drag from this folder. The agent can try this with "
            "the vision loop, but a FFmpeg cut is always produced as a reliable final."
        ),
    }


@app.post("/focus")
def focus(req: FocusIn, _auth: str = Depends(_require_auth)) -> dict[str, Any]:
    if not IS_WIN:
        return {"ok": True, "simulated": True, "matched": False}
    import ctypes.wintypes

    needle = (req.title_contains or "").lower()
    found = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.wintypes.HWND, ctypes.wintypes.LPARAM)
    def _enum(hwnd, _lparam):
        if not ctypes.windll.user32.IsWindowVisible(hwnd):
            return True
        length = ctypes.windll.user32.GetWindowTextLengthW(hwnd)
        buf = ctypes.create_unicode_buffer(length + 1)
        ctypes.windll.user32.GetWindowTextW(hwnd, buf, length + 1)
        title = buf.value or ""
        if needle and needle in title.lower():
            found.append((hwnd, title))
        return True

    ctypes.windll.user32.EnumWindows(_enum, 0)
    if not found:
        return {"ok": False, "matched": False}
    hwnd, title = found[0]
    ctypes.windll.user32.ShowWindow(hwnd, 9)  # SW_RESTORE
    ctypes.windll.user32.SetForegroundWindow(hwnd)
    return {"ok": True, "matched": True, "title": title}


def main() -> None:
    if not TOKEN:
        logger.error("Set GROKPC_HELPER_TOKEN or AGENT_TOKEN (see helper.env). Refusing to start.")
        sys.exit(2)
    import uvicorn

    logger.info("GrokPC helper on %s:%s (Windows=%s)", HOST, PORT, IS_WIN)
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")


if __name__ == "__main__":
    main()
