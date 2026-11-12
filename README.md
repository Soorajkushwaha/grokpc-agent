# GrokPC — video-production assistant

Mobile control center + self-hosted backend that plans, voices, and edits YouTube videos on your **Windows laptop** (WSL2 + Ubuntu 24.04). Messaging (WhatsApp / Gmail / Telegram) has been removed. The existing browser vision agent (`/api/task` — the one that already opened YouTube) is unchanged.

**Frontend** (`frontend/`): Vite + React PWA at [https://grokpc-agent.simple-sooraj.workers.dev](https://grokpc-agent.simple-sooraj.workers.dev)

**Backend** (`backend/`): FastAPI + Playwright vision loop (DeepSeek Flash, Gemini fallback) + a video pipeline (planning → voiceover → Grok Imagine / Google Vids clips → FFmpeg, with an optional Windows CapCut helper).

## Phase 1 (now) vs Phase 2 (flags off)

| Piece | Phase | Default |
| --- | --- | --- |
| Simplified video-first app (Home / Videos / Screen / Settings) | 1 | on |
| Jobs + channels REST API, `/api/status` | 1 | on |
| ChatGPT web planning, DeepSeek text fallback | 1 | on |
| Voiceover (gTTS, optional Gemini TTS) | 1 | on |
| FFmpeg auto-edit (always produces a final MP4) | 1 | on |
| Windows desktop helper for CapCut (launch + import folder) | 1 | on if helper is running |
| Browser vision `/api/task` (YouTube etc.) | 1 | on, unchanged |
| Grok Imagine + Google Vids visuals (login in noVNC; falls back if needed) | 1 | `FEATURE_GROK_IMAGINE=1`, `FEATURE_GOOGLE_VIDS=1` |
| Veo generation + billing-page credit scrape | 2 | `FEATURE_VEO=0`, `FEATURE_CREDIT_CHECK=0` |
| YouTube Studio upload + approve-publish | 2 | `FEATURE_YOUTUBE_UPLOAD=0` |
| Autopilot (idle / quiet hours / daily caps) | 2 | `FEATURE_AUTOPILOT=0` |
| Google AI Studio voice in the browser | 2 | `FEATURE_AISTUDIO_VOICE=0` |
| Tablet (Termux) 24x7 worker (story + gTTS + FFmpeg fallback visuals) | 1 | `scripts/tablet/install.sh` |

## Naya system kaise chalta hai (Hinglish)

1. Phone pe app kholo. **Home** pe channel chuno, topic likho, **Nayi Video Banao**.
2. Agent **Kahani** likhta hai — pehle ChatGPT (Chrome profile, ek baar noVNC se login), na ho to DeepSeek API (key pehle se laptop pe hai).
3. **Awaz** banati hai — free gTTS, ya Gemini TTS agar `USE_GEMINI_TTS=1` aur key ho.
4. **Visual** — PC ka Chrome `grok.com/imagine` aur `vids.google.com` kholta hai, har scene ka clip banwata hai aur download karta hai. Login, credits, ya timeout fail ho to FFmpeg ke basic visuals use hote hain. Kabhi credits kharidta nahi.
5. **Edit** — FFmpeg clips ko awaaz ke saath jod ke final MP4 banata hai. Agar Windows helper chal raha hai aur CapCut installed hai, CapCut khul jata hai aur media `Videos\GrokPC\import` me aa jata hai. CapCut ka automatic timeline edit reliable nahi (koi official API nahi), isliye FFmpeg wali file hamesha ready rehti hai.
6. **Videos** tab me har job ke steps dikhte hain: Pause / Resume / Cancel.
7. **Screen** tab me noVNC + wahi purana “browser ko bolo” box (`/api/task`).
8. Auto mode, Veo, YouTube public upload — **Phase 2**, abhi band. Final file laptop pe `/data/outputs` (ya `OUTPUT_DIR`) me milti hai.

Ek baar ka login (Screen / noVNC me, apna Chrome profile): ChatGPT, **Grok Imagine** (`grok.com/imagine`) aur **Google Vids** (`vids.google.com`) taaki Visual step clips bana sake. Baad me Phase 2 ke liye Google AI Studio, Gemini/Flow, YouTube Studio.

## Quick start (frontend)

```bash
cd frontend
npm install
npm run build    # do not deploy from here unless asked
```

Settings stores only the Cloudflare Tunnel URL and `AGENT_TOKEN`. API keys never leave the machine.

## Windows laptop (Phase 1, recommended)

Hinglish steps: **[windows/README_HINDI.md](./windows/README_HINDI.md)**. CapCut helper (no admin): **[windows/desktop_helper/README.md](./windows/desktop_helper/README.md)**.

Short version: the agent is already installed in WSL. After pulling this update, copy new backend files into `/app/agent` and restart `grokpc-agent`. Then optionally run `windows/desktop_helper/install-helper.ps1` (no admin) and install CapCut on Windows.

## Codespaces / VPS / tablet

- Codespaces: **[CODESPACES.md](./CODESPACES.md)** (backup, not 24/7).
- VPS: **[SERVER_STEPS.md](./SERVER_STEPS.md)** / **[PLATFORMS.md](./PLATFORMS.md)**.
- Android tablet (24x7 worker, no browser clips): in F-Droid Termux run `curl -fsSL https://raw.githubusercontent.com/Soorajkushwaha/grokpc-agent/main/scripts/tablet/install.sh | bash`, then paste the URL + token into **Settings → Tablet**. Details: **[android/README_HINDI.md](./android/README_HINDI.md)** (older Chromium/noVNC path). CapCut-on-Android is not supported.

## Security

- FastAPI, noVNC and the Windows helper bind to `127.0.0.1` only
- Every REST and WebSocket call requires `Authorization: Bearer AGENT_TOKEN`
- CORS is limited to the Workers app + localhost
- Phase 2 YouTube uploads (when enabled) default to **Private**; Public needs an explicit approve-publish call

## License

Private repository. All rights reserved.
