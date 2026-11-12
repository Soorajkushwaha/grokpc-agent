"""Visuals step: Grok Imagine and Google Vids clips, then FFmpeg stitches them.

Opens the PC's persistent Playwright Chrome profile (the same one the vision
agent uses — never a second persistent context). For each scene prompt it
tries a deterministic Playwright flow, then a tight vision-loop goal, and
saves downloads into /data/outputs/<job>/clips/.

If the site needs a login, shows a paywall, has no credits, or times out,
we report that in the step detail and return no paths so the edit step
falls back to the existing title-card / slideshow behaviour. We never
click Buy / Upgrade / Subscribe and never purchase credits.

DRY_RUN writes short fake colour clips so tests can exercise the stitch path.
"""
from __future__ import annotations

import asyncio
import logging
import re
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional
from urllib.parse import urlparse

from config import (
    CLIP_TIMEOUT_SEC,
    DRY_RUN,
    FEATURE_GOOGLE_VIDS,
    FEATURE_GROK_IMAGINE,
    FEATURE_POLLINATIONS,
    FEATURE_VEO,
    GEMINI_API_KEY,
    MAX_CLIPS_PER_JOB,
    MAX_IMAGE_SCENES,
)
from still_gen import (
    fake_images,
    generate_pollinations_images,
    is_accepted_download,
)

logger = logging.getLogger("grokpc.generators")
LogFn = Callable[[dict[str, Any]], Awaitable[None]]

GROK_IMAGINE_URL = "https://grok.com/imagine"
GOOGLE_VIDS_URL = "https://vids.google.com"
GOOGLE_VIDS_NEW_URL = "https://vids.new"

LOGIN_MSG = {
    "grok_imagine": "Grok login needed in noVNC",
    "google_vids": "Google login needed in noVNC",
    "veo": "Google login needed in noVNC",
}

# URL fragments that mean we landed on a sign-in wall.
_AUTH_URL_PARTS = (
    "accounts.google.com",
    "accounts.x.com",
    "twitter.com/i/flow",
    "x.com/i/flow/login",
    "x.com/login",
    "api.twitter.com/oauth",
    "signin.google",
    "/o/oauth2",
    "login.microsoftonline.com",
)

_AUTH_TEXT_RE = re.compile(
    r"(sign in to (continue|grok|x|google|continue using)|"
    r"log in to (continue|grok)|"
    r"sign in with (google|x|apple|twitter)|"
    r"create (an )?account to (continue|generate)|"
    r"you (need|must|have) to (sign|log) in)",
    re.I,
)

# Softer "Sign in" only counts as auth when there is no prompt box.
_SOFT_AUTH_RE = re.compile(r"\b(sign in|log in|sign up|log in to grok)\b", re.I)

_PAYWALL_RE = re.compile(
    r"(out of credits|no credits (left|remaining)|0 credits|"
    r"upgrade to (premium|pro|super|plus|ultra)|"
    r"subscribe to (continue|generate|watch)|"
    r"buy (more )?credits|purchase credits|add a payment|"
    r"you've reached (your|the) (limit|quota|cap)|"
    r"quota (exceeded|reached)|"
    r"video (is|requires) (available )?(on|with|for) (premium|a paid)|"
    r"choose a plan|pick a plan|"
    r"start (your )?(free )?trial|"
    r"free (plan|tier) (does not|doesn't|cannot|can't))",
    re.I,
)

_CREDIT_RE = re.compile(
    r"(?P<n>\d+)\s*(?P<unit>credits?|generations?|videos?|clips?|seconds?)?"
    r"\s*(?P<tail>left|remaining|available)|"
    r"(?P<head>remaining|left|available)[:\s]+(?P<n2>\d+)|"
    r"(?P<kind>quota|usage)[:\s]+(?P<used>\d+)\s*/\s*(?P<total>\d+)",
    re.I,
)

_FORBIDDEN_CLICK_RE = re.compile(
    r"upgrade|subscribe|buy(\s|$) |purchase|checkout|add (a )?payment|"
    r"start (your )?(free )?trial|get (pro|plus|super|premium|ultra)|"
    r"go (pro|premium)|pricing|choose a plan|pick a plan",
    re.I,
)

_PROMPT_SELECTORS = (
    "textarea:visible",
    "textarea",
    "[contenteditable='true']:visible",
    "[contenteditable='true']",
    "[role='textbox']:visible",
    "[role='textbox']",
    "input[type='text']:visible",
)

_GENERATE_NAMES = (
    r"^(generate|imagine|create|make video|make it|create video|"
    r"create ai videos?|help me create|submit|run|go|send)$",
)

_VIDEO_TAB_NAMES = (r"^(video|videos|ai video|create ai videos?)$",)

_DOWNLOAD_NAMES = (r"^(download|export|save|save video|download video|export mp4)$",)

_COOKIE_NAMES = (
    r"^(accept all|accept all cookies|i agree|accept cookies|allow all|"
    r"reject all|reject optional|got it|ok)$",
)


async def _emit(log: Optional[LogFn], title: str, message: str) -> None:
    logger.info("%s: %s", title, message)
    if log:
        await log({"type": "action", "title": title, "message": message})


def scene_specs(plan: dict[str, Any], limit: Optional[int] = None) -> list[dict[str, Any]]:
    """Pull per-scene video prompts (and durations) out of a planner plan."""
    cap = MAX_CLIPS_PER_JOB if limit is None else limit
    scenes = plan.get("scenes") if isinstance(plan.get("scenes"), list) else []
    out: list[dict[str, Any]] = []
    for i, raw in enumerate(scenes):
        s = raw if isinstance(raw, dict) else {"narration": str(raw)}
        prompt = (
            str(s.get("video_prompt") or "").strip()
            or str(s.get("image_prompt") or "").strip()
            or str(s.get("visual") or "").strip()
            or str(s.get("narration") or "").strip()
        )
        if not prompt:
            continue
        try:
            dur = int(s.get("duration_sec") or s.get("duration") or 5)
        except (TypeError, ValueError):
            dur = 5
        out.append({"index": i + 1, "prompt": prompt, "duration_sec": max(2, dur)})
        if len(out) >= cap:
            break
    if not out:
        title = str(plan.get("title") or plan.get("hook") or "cinematic scene")
        script = str(plan.get("voiceover_script") or plan.get("story") or title)
        out.append({"index": 1, "prompt": f"{title}. {script}"[:600], "duration_sec": 6})
    return out[:cap]


def classify_page(url: str, title: str, text: str, password_count: int = 0) -> dict[str, Any]:
    """Pure classifier used by the driver and by unit tests. No network."""
    url_l = (url or "").lower()
    title_l = (title or "").lower()
    text = text or ""
    sample = text[:12000]

    auth = password_count > 0
    if any(part in url_l for part in _AUTH_URL_PARTS):
        auth = True
    path = urlparse(url or "").path.lower()
    if path.rstrip("/").endswith("/login") or path.rstrip("/").endswith("/signup") or "/sign-in" in path:
        auth = True
    if _AUTH_TEXT_RE.search(sample) or _AUTH_TEXT_RE.search(title_l):
        auth = True
    elif not auth and _SOFT_AUTH_RE.search(sample):
        # Marketing + "Sign in" only counts when there is no prompt-like field mentioned.
        if not re.search(r"\b(textarea|prompt|imagine something|describe|what do you want)\b", sample, re.I):
            # Many login walls are just a heading + Sign in button.
            if re.search(r"\b(sign in|log in)\b", sample, re.I) and len(sample) < 4000:
                auth = True

    credits_note = ""
    remaining: Optional[int] = None
    m = _CREDIT_RE.search(sample)
    if m:
        gd = m.groupdict()
        if gd.get("n") is not None:
            remaining = int(gd["n"])
            unit = (gd.get("unit") or "credits").strip()
            credits_note = f"{remaining} {unit} left"
        elif gd.get("n2") is not None:
            remaining = int(gd["n2"])
            credits_note = f"{remaining} remaining"
        elif gd.get("total") is not None:
            used, total = int(gd["used"]), int(gd["total"])
            remaining = max(0, total - used)
            credits_note = f"usage {used}/{total}"

    no_credits = bool(_PAYWALL_RE.search(sample))
    if remaining == 0:
        no_credits = True

    challenge = bool(
        re.search(r"verify you are human|attention required|unusual traffic|cf-challenge", sample, re.I)
    )

    return {
        "auth_required": bool(auth),
        "no_credits": bool(no_credits) and not auth,
        "credits_remaining": remaining,
        "credits_note": credits_note,
        "challenge": challenge,
        "url": url,
        "title": title,
    }


async def _page_state(page: Any) -> dict[str, Any]:
    url = ""
    title = ""
    text = ""
    passwords = 0
    try:
        url = page.url or ""
    except Exception:
        pass
    try:
        title = await page.title()
    except Exception:
        pass
    try:
        text = await page.inner_text("body", timeout=8000)
    except Exception:
        try:
            text = await page.content()
        except Exception:
            text = ""
    try:
        passwords = await page.locator('input[type="password"]').count()
    except Exception:
        passwords = 0
    return classify_page(url, title, text[:12000], passwords)


async def _dismiss_cookies(page: Any) -> None:
    for pat in _COOKIE_NAMES:
        try:
            loc = page.get_by_role("button", name=re.compile(pat, re.I))
            if await loc.count():
                await loc.first.click(timeout=2500)
                await asyncio.sleep(0.4)
                return
        except Exception:
            continue


async def _click_named(page: Any, patterns: tuple[str, ...], roles: tuple[str, ...] = ("button", "tab")) -> bool:
    for role in roles:
        for pat in patterns:
            try:
                loc = page.get_by_role(role, name=re.compile(pat, re.I))
                n = await loc.count()
                if not n:
                    continue
                # Skip paywall / purchase buttons even if the name loosely matches.
                label = (await loc.first.inner_text()).strip()
                if _FORBIDDEN_CLICK_RE.search(label or ""):
                    continue
                await loc.first.click(timeout=4000)
                return True
            except Exception:
                continue
    return False


async def _find_prompt_box(page: Any) -> Any:
    for sel in _PROMPT_SELECTORS:
        try:
            loc = page.locator(sel)
            count = await loc.count()
            for i in range(min(count, 6)):
                box = loc.nth(i)
                try:
                    if await box.is_visible():
                        return box
                except Exception:
                    continue
        except Exception:
            continue
    return None


async def _fill_prompt(page: Any, box: Any, prompt: str) -> bool:
    try:
        await box.click(timeout=4000)
        await asyncio.sleep(0.15)
        try:
            await box.fill(prompt, timeout=4000)
            return True
        except Exception:
            pass
        # contenteditable / custom editors often reject fill().
        try:
            await page.keyboard.press("Control+a")
            await page.keyboard.press("Backspace")
        except Exception:
            pass
        try:
            await box.evaluate(
                """(el, text) => {
                    el.focus();
                    if ('value' in el) el.value = text;
                    el.textContent = text;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }""",
                prompt,
            )
            return True
        except Exception:
            await page.keyboard.type(prompt[:1500], delay=5)
            return True
    except Exception as exc:
        logger.info("fill prompt failed: %s", exc)
        return False


def _attach_download_saver(page: Any, dest_dir: Path, collected: list[Path]) -> None:
    def _on_download(download: Any) -> None:
        async def _save() -> None:
            name = download.suggested_filename or f"download_{len(collected)+1}.mp4"
            name = re.sub(r"[^A-Za-z0-9._-]+", "_", name)[:80] or "clip.mp4"
            path = dest_dir / name
            if path.exists():
                path = dest_dir / f"{path.stem}_{len(collected)+1}{path.suffix or '.mp4'}"
            try:
                await download.save_as(str(path))
                if path.is_file() and path.stat().st_size > 800:
                    collected.append(path)
                    logger.info("saved download %s (%s bytes)", path.name, path.stat().st_size)
            except Exception as exc:
                logger.info("download save failed: %s", exc)

        try:
            loop = asyncio.get_running_loop()
            loop.create_task(_save())
        except RuntimeError:
            pass

    page.on("download", _on_download)


async def _harvest_media(page: Any, dest: Path, videos_only: bool = True) -> Optional[Path]:
    """Pull a generated <video> (http or blob) or a downloadable <a> into dest."""
    dest.parent.mkdir(parents=True, exist_ok=True)

    async def _fetch_bytes(url: str) -> Optional[bytes]:
        if not url or url.startswith("javascript:"):
            return None
        try:
            data = await page.evaluate(
                """async (url) => {
                    try {
                        const r = await fetch(url);
                        if (!r.ok) return null;
                        const buf = await r.arrayBuffer();
                        return Array.from(new Uint8Array(buf));
                    } catch (e) { return null; }
                }""",
                url,
            )
        except Exception:
            return None
        if not data or len(data) < 800:
            return None
        return bytes(data)

    try:
        infos = await page.evaluate(
            """() => [...document.querySelectorAll('video')].map(v => ({
                src: v.currentSrc || v.src || (v.querySelector('source') || {}).src || '',
                dur: Number.isFinite(v.duration) ? v.duration : 0
            }))"""
        )
    except Exception:
        infos = []
    for info in infos or []:
        src = (info or {}).get("src") or ""
        data = await _fetch_bytes(src)
        if data:
            dest.write_bytes(data)
            return dest

    try:
        hrefs = await page.evaluate(
            """() => [...document.querySelectorAll('a[download], a[href$=".mp4"], a[href$=".webm"], a[href$=".mov"]')]
                .map(a => a.href).filter(Boolean)"""
        )
    except Exception:
        hrefs = []
    for href in hrefs or []:
        data = await _fetch_bytes(href)
        if data:
            dest.write_bytes(data)
            return dest

    if videos_only:
        return None
    # Large stills only as a last resort (editor can slideshow them).
    try:
        imgs = await page.evaluate(
            """() => [...document.querySelectorAll('img')]
                .filter(i => i.naturalWidth >= 640 && i.naturalHeight >= 360)
                .slice(0, 2)
                .map(i => i.currentSrc || i.src)"""
        )
    except Exception:
        imgs = []
    for href in imgs or []:
        low = (href or "").lower()
        if not href or any(s in low for s in ("avatar", "logo", "icon", "sprite", "emoji", "favicon")):
            continue
        data = await _fetch_bytes(href)
        if not data or len(data) < 8000:
            continue
        img_path = dest.with_suffix(".jpg")
        if data[:8].startswith(b"\x89PNG"):
            img_path = dest.with_suffix(".png")
        elif data[:4] == b"RIFF":
            img_path = dest.with_suffix(".webp")
        img_path.write_bytes(data)
        return img_path
    return None


async def _deterministic_generate(page: Any, prompt: str) -> str:
    """Best-effort selectors. Returns a short status string."""
    await _click_named(page, _VIDEO_TAB_NAMES, roles=("tab", "button"))
    await asyncio.sleep(0.3)
    box = await _find_prompt_box(page)
    if box is None:
        return "no_prompt"
    if not await _fill_prompt(page, box, prompt):
        return "fill_failed"
    # Prefer a dedicated generate button; Enter is the fallback.
    clicked = await _click_named(page, _GENERATE_NAMES, roles=("button",))
    if not clicked:
        try:
            await page.keyboard.press("Enter")
            clicked = True
        except Exception:
            pass
    if not clicked:
        return "no_generate"
    return "submitted"


def _accepted_from_downloads(collected: list[Path]) -> Optional[Path]:
    """Only files that arrived via Playwright's download event are trusted."""
    for path in reversed(list(collected)):
        if is_accepted_download(Path(path), from_download_event=True):
            return Path(path)
    return None


async def _wait_for_result(
    page: Any,
    dest: Path,
    collected: list[Path],
    timeout: float,
) -> Optional[Path]:
    # Guard: never harvest a <video> already on the page (Google Vids marketing
    # template, stock smiling people, logos). Only a real file download counts.
    deadline = asyncio.get_event_loop().time() + max(8.0, timeout)
    last_state: dict[str, Any] = {}
    while asyncio.get_event_loop().time() < deadline:
        got = _accepted_from_downloads(collected)
        if got:
            return got
        try:
            last_state = await _page_state(page)
        except Exception:
            last_state = {}
        if last_state.get("auth_required"):
            return None
        if last_state.get("no_credits"):
            return None
        # Click Download if a video looks ready, then wait for the download event.
        try:
            vid_n = await page.locator("video").count()
        except Exception:
            vid_n = 0
        if vid_n:
            await _click_named(page, _DOWNLOAD_NAMES, roles=("button", "link"))
        await asyncio.sleep(2.5)
    return _accepted_from_downloads(collected)


def _vision_goal(provider: str, prompt: str) -> str:
    login_msg = LOGIN_MSG.get(provider, "login needed in noVNC")
    return (
        f"You are on the {provider} video-generation site. Tight goal only.\n"
        f"1. If this is a login or sign-in page, do NOT log in and do NOT type a password. "
        f"Use action done with text AUTH_REQUIRED ({login_msg}).\n"
        f"2. If you see a paywall, 'buy credits', 'upgrade', 'subscribe', 'choose a plan', "
        f"or 'out of credits' as the only way to generate, do NOT click it and do NOT pay. "
        f"Use action done with text NO_CREDITS.\n"
        f"3. If a cookie banner is in the way, click Accept all or Reject all.\n"
        f"4. Switch to Video mode if the tool is currently on Image.\n"
        f"5. Clear the prompt box and paste this exact prompt, then click Generate / Create / "
        f"Make video / Create AI videos (never Buy or Upgrade):\n"
        f"---\n{prompt}\n---\n"
        f"6. Wait until a video finishes generating. Then click Download or Export and save the file.\n"
        f"7. When the video is downloading or clearly visible and saved, use action done with text DOWNLOADED.\n"
        f"8. If it fails, use action done with text FAILED: short reason.\n"
        f"Reply with one JSON action at a time. Do not wander off this page."
    )


async def _vision_generate(page: Any, provider: str, prompt: str, log: Optional[LogFn]) -> str:
    from vision_loop import run_vision_task

    result = await run_vision_task(
        page,
        _vision_goal(provider, prompt),
        log=log,
        max_steps=16,
    )
    text = str(result.get("result") or "")
    return text


async def _generate_one_clip(
    page: Any,
    provider: str,
    scene: dict[str, Any],
    dest_dir: Path,
    log: Optional[LogFn],
) -> dict[str, Any]:
    idx = int(scene.get("index") or 1)
    prompt = str(scene.get("prompt") or "")
    dest = dest_dir / f"{provider}_{idx:02d}.mp4"
    collected: list[Path] = []
    _attach_download_saver(page, dest_dir, collected)

    submitted = await _deterministic_generate(page, prompt)
    await _emit(log, provider, f"clip {idx}: {submitted}")
    await asyncio.sleep(1.2)
    state = await _page_state(page)
    if state.get("auth_required"):
        return {"status": "AUTH_REQUIRED"}
    if state.get("no_credits"):
        return {"status": "NO_CREDITS", "note": state.get("credits_note") or "no credits"}

    timeout = max(20, CLIP_TIMEOUT_SEC)
    # Leave some time for a vision retry if deterministic produced nothing.
    first_budget = min(timeout, 90) if submitted != "submitted" else timeout * 0.65
    path = await _wait_for_result(page, dest, collected, first_budget)
    if path:
        return {"status": "ok", "path": path}

    # Vision-loop fallback with a tight goal, then harvest again.
    await _emit(log, provider, f"clip {idx}: trying vision loop")
    try:
        leftover = max(25.0, timeout - first_budget)
        vision_text = await asyncio.wait_for(_vision_generate(page, provider, prompt, log), timeout=leftover)
    except asyncio.TimeoutError:
        vision_text = "FAILED: vision timeout"
    except Exception as exc:
        vision_text = f"FAILED: {exc}"
    upper = (vision_text or "").upper()
    if "AUTH_REQUIRED" in upper:
        return {"status": "AUTH_REQUIRED"}
    if "NO_CREDITS" in upper:
        return {"status": "NO_CREDITS", "note": vision_text}
    path = await _wait_for_result(page, dest, collected, 25)
    if path:
        return {"status": "ok", "path": path, "note": vision_text}
    return {"status": "failed", "note": vision_text or "no clip"}


async def _open_and_check(page: Any, url: str, provider: str, log: Optional[LogFn]) -> dict[str, Any]:
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=45000)
    except Exception as exc:
        return {"status": "error", "note": f"goto failed: {exc}"}
    try:
        await page.wait_for_load_state("networkidle", timeout=8000)
    except Exception:
        pass
    await asyncio.sleep(1.5)
    await _dismiss_cookies(page)
    state = await _page_state(page)
    await _emit(
        log,
        provider,
        f"opened {state.get('url') or url}"
        + (f" · {state['credits_note']}" if state.get("credits_note") else ""),
    )
    if state.get("challenge"):
        return {"status": "blocked", "note": "captcha/challenge on page", **state}
    if state.get("auth_required"):
        return {"status": "AUTH_REQUIRED", "note": LOGIN_MSG.get(provider, "login needed"), **state}
    if state.get("no_credits"):
        return {
            "status": "NO_CREDITS",
            "note": state.get("credits_note") or "no credits visible, not buying",
            **state,
        }
    return {"status": "ok", **state}


async def _run_provider(
    page: Any,
    provider: str,
    url: str,
    scenes: list[dict[str, Any]],
    dest_dir: Path,
    log: Optional[LogFn],
) -> dict[str, Any]:
    opened = await _open_and_check(page, url, provider, log)
    if opened.get("status") != "ok":
        return {"paths": [], **opened}

    paths: list[Path] = []
    notes: list[str] = []
    if opened.get("credits_note"):
        notes.append(str(opened["credits_note"]))

    for scene in scenes:
        try:
            result = await asyncio.wait_for(
                _generate_one_clip(page, provider, scene, dest_dir, log),
                timeout=max(30, CLIP_TIMEOUT_SEC + 15),
            )
        except asyncio.TimeoutError:
            notes.append(f"clip {scene.get('index')} timed out")
            await _emit(log, provider, f"clip {scene.get('index')} timed out — skipping")
            continue
        except Exception as exc:
            notes.append(f"clip {scene.get('index')}: {exc}")
            logger.exception("clip generation failed")
            continue
        status = result.get("status")
        if status == "AUTH_REQUIRED":
            return {
                "status": "AUTH_REQUIRED",
                "note": LOGIN_MSG.get(provider, "login needed"),
                "paths": paths,
            }
        if status == "NO_CREDITS":
            return {
                "status": "NO_CREDITS",
                "note": result.get("note") or "no credits, not buying",
                "paths": paths,
            }
        if status == "ok" and result.get("path"):
            paths.append(Path(result["path"]))
            await _emit(log, provider, f"saved {Path(result['path']).name}")
        else:
            notes.append(str(result.get("note") or f"clip {scene.get('index')} failed"))

    return {
        "status": "ok" if paths else "failed",
        "paths": paths,
        "note": "; ".join(n for n in notes if n) or f"{len(paths)} clips",
    }


async def _with_agent_page(agent: Any):
    """Reuse the vision agent's persistent context; never launch a second one."""
    if agent is None:
        raise RuntimeError("no browser agent")
    if hasattr(agent, "exclusive_page"):
        return agent.exclusive_page()

    # Fallback for older agent objects: take the lock ourselves.
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def _fallback():
        lock = getattr(agent, "_lock", None)
        if lock is not None:
            await lock.acquire()
        try:
            if hasattr(agent, "initialize_browser"):
                await agent.initialize_browser()
            page = None
            ctx = getattr(agent, "context", None)
            if ctx is not None:
                page = await ctx.new_page()
            else:
                page = getattr(agent, "page", None)
            if page is None:
                raise RuntimeError("agent has no browser page")
            try:
                yield page
            finally:
                if ctx is not None and page is not getattr(agent, "page", None):
                    try:
                        await page.close()
                    except Exception:
                        pass
        finally:
            if lock is not None:
                lock.release()

    return _fallback()


async def _fake_clips(plan: dict[str, Any], dest_dir: Path, log: Optional[LogFn] = None) -> dict[str, Any]:
    """DRY_RUN: short colour clips so the edit step can stitch them."""
    import shutil

    dest_dir.mkdir(parents=True, exist_ok=True)
    scenes = scene_specs(plan)
    colors = ["0x1a3a5c", "0x5c1a3a", "0x1a5c3a", "0x5c4a1a", "0x3a1a5c", "0x1a5c5c"]
    paths: list[Path] = []
    if not shutil.which("ffmpeg"):
        # Tiny but valid-enough files so tests on boxes without ffmpeg still see paths.
        for i, scene in enumerate(scenes):
            path = dest_dir / f"dry_{i+1:02d}.mp4"
            path.write_bytes(b"\x00\x00fake-clip" * 80)
            paths.append(path)
        return {"status": "ok", "paths": paths, "provider": "dry_run", "note": "DRY_RUN fake clips (no ffmpeg)"}

    for i, scene in enumerate(scenes):
        path = dest_dir / f"dry_{i+1:02d}.mp4"
        color = colors[i % len(colors)]
        dur = min(3, max(1, int(scene.get("duration_sec") or 2)))
        cmd = [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", f"color=c={color}:s=640x360:d={dur}",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-t", str(dur),
            "-movflags", "+faststart",
            str(path),
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        _out, err = await proc.communicate()
        if proc.returncode != 0 or not path.is_file():
            raise RuntimeError(err.decode("utf-8", "replace")[-400:] or "ffmpeg fake clip failed")
        paths.append(path)
    await _emit(log, "Visuals", f"DRY_RUN {len(paths)} fake clips")
    return {
        "status": "ok",
        "paths": paths,
        "provider": "dry_run",
        "note": f"DRY_RUN fake clips ({len(paths)})",
    }


def _provider_list(forced: Optional[str] = None) -> list[tuple[str, str]]:
    if forced:
        urls = {
            "grok_imagine": GROK_IMAGINE_URL,
            "grok": GROK_IMAGINE_URL,
            "google_vids": GOOGLE_VIDS_URL,
            "vids": GOOGLE_VIDS_URL,
            "veo": "https://gemini.google.com/app",
        }
        url = urls.get(forced)
        return [(forced, url)] if url else []
    out: list[tuple[str, str]] = []
    if FEATURE_GROK_IMAGINE:
        out.append(("grok_imagine", GROK_IMAGINE_URL))
    if FEATURE_GOOGLE_VIDS:
        out.append(("google_vids", GOOGLE_VIDS_URL))
    return out


async def generate_media(
    plan: dict[str, Any],
    *,
    job_id: str,
    dest_dir: Path,
    agent: Any = None,
    log: Optional[LogFn] = None,
    provider: Optional[str] = None,
) -> dict[str, Any]:
    """Entry point used by the pipeline visuals (and legacy generate) step."""
    dest_dir = Path(dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)

    if not (FEATURE_VEO or FEATURE_GROK_IMAGINE or FEATURE_GOOGLE_VIDS or FEATURE_POLLINATIONS):
        return {
            "status": "skipped",
            "paths": [],
            "provider": provider or "",
            "note": "visuals flags are off",
        }

    if DRY_RUN:
        # When a browser clip flag is on (unit tests), keep the fake-clip path.
        # Default DRY_RUN uses stills so the Ken Burns editor is exercised.
        if FEATURE_GROK_IMAGINE or FEATURE_GOOGLE_VIDS or FEATURE_VEO:
            fake = await _fake_clips(plan, dest_dir, log=log)
        else:
            fake = await fake_images(plan, dest_dir, log=log)
        fake["gemini_key_present"] = bool(GEMINI_API_KEY)
        return fake

    # Optional browser providers (off by default). Only real file-downloads count.
    paths: list[Path] = []
    notes: list[str] = []
    auth: list[str] = []
    used_provider = ""

    providers = _provider_list(provider)
    scenes = scene_specs(plan)
    if providers and scenes and agent is not None:
        remaining = list(scenes)
        try:
            async with (await _with_agent_page(agent)) as page:
                try:
                    page.set_default_timeout(12000)
                except Exception:
                    pass
                for name, url in providers:
                    if not remaining:
                        break
                    await _emit(log, "Visuals", f"Trying {name} for {len(remaining)} scene(s)")
                    try:
                        result = await _run_provider(page, name, url, remaining, dest_dir, log)
                    except Exception as exc:
                        logger.exception("provider %s failed", name)
                        notes.append(f"{name}: {exc}")
                        continue
                    status = result.get("status")
                    got = [
                        Path(p) for p in (result.get("paths") or [])
                        if is_accepted_download(Path(p), from_download_event=True)
                    ]
                    paths.extend(got)
                    if got:
                        used_provider = used_provider or name
                        remaining = remaining[len(got):]
                    if status == "AUTH_REQUIRED":
                        msg = LOGIN_MSG.get(name, "login needed in noVNC")
                        auth.append(name)
                        notes.append(msg)
                        await _emit(log, "Visuals", msg)
                        continue
                    if status == "NO_CREDITS":
                        notes.append(f"{name}: {result.get('note') or 'no credits, not buying'}")
                        await _emit(log, "Visuals", notes[-1])
                        continue
                    if result.get("note"):
                        notes.append(f"{name}: {result['note']}")
        except Exception as exc:
            logger.exception("visuals browser session failed")
            notes.append(f"browser: {exc}")
    elif providers and agent is None:
        notes.append("no browser agent for Grok/Vids — using Pollinations")

    # Default free path: Pollinations stills. Use them when we don't have a
    # full set of trusted downloaded clips (the usual case, flags off).
    want_stills = FEATURE_POLLINATIONS and (not provider or provider in {"pollinations", "stills", ""})
    if want_stills and (not paths or len(paths) < 2):
        aspect_w, aspect_h = 1280, 720
        try:
            stills = await generate_pollinations_images(
                plan,
                dest_dir / "stills",
                job_id=job_id,
                log=log,
                width=aspect_w,
                height=aspect_h,
                limit=MAX_IMAGE_SCENES,
            )
        except Exception as exc:
            logger.exception("pollinations failed")
            notes.append(f"pollinations: {exc}")
            stills = {}
        still_paths = [Path(p) for p in (stills.get("paths") or []) if Path(p).is_file()]
        if still_paths:
            # Prefer stills as the default look; drop untrusted/partial browser clips.
            paths = still_paths
            used_provider = "pollinations"
            if stills.get("note"):
                notes.append(str(stills["note"]))
        elif stills.get("note"):
            notes.append(str(stills["note"]))

    note = "; ".join(n for n in notes if n)
    if paths:
        return {
            "status": "ok",
            "paths": paths,
            "provider": used_provider,
            "auth": auth,
            "note": note or f"{len(paths)} files",
        }
    if not note:
        note = "no clips; falling back to basic visuals"
    return {
        "status": "skipped",
        "paths": [],
        "provider": used_provider,
        "auth": auth,
        "note": note,
    }



# Back-compat alias used in older comments / tests.
generate_visuals = generate_media
