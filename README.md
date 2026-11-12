# GrokPC Agent

Mobile control center + self-hosted Ubuntu backend for a personal browser agent.

- **Frontend** (`frontend/`): Vite + React PWA, deployed at [https://grokpc-agent.simple-sooraj.workers.dev](https://grokpc-agent.simple-sooraj.workers.dev)
- **Backend** (`backend/`): FastAPI + Playwright vision loop (DeepSeek Flash, Gemini fallback), FFmpeg + gTTS, optional Telegram approvals

**Primary right now:** your **Windows laptop** (WSL2 + Ubuntu 24.04). See **[windows/README_HINDI.md](./windows/README_HINDI.md)**.

**Backup / testing:** **[GitHub Codespaces](./CODESPACES.md)** (free quota, not 24/7).

**Android tablet (Termux):** **[android/README_HINDI.md](./android/README_HINDI.md)** — Redmi Pad / ARM64, F-Droid Termux + system Chromium over CDP. App Settings has a Laptop / Tablet / VPS switcher.

**Cheap UPI VPS** (when you want the laptop off): **[PLATFORMS.md](./PLATFORMS.md)**. The backend also runs on **any Ubuntu 24.04 VPS** (x86_64 or ARM64). A 4 GB RAM plan is enough (the installer creates a swapfile and uses a light IceWM desktop). Oracle Always Free is optional if you can get an Ampere A1 VM.

## Quick start (frontend)

```bash
cd frontend
npm install
npm run dev
```

Settings stores only the Cloudflare Tunnel URL and `AGENT_TOKEN`. API keys never leave the VPS.

## Windows laptop (recommended until you have a VPS)

Hinglish steps: **[windows/README_HINDI.md](./windows/README_HINDI.md)**. Short version: download the repo ZIP from GitHub (private repo, so `irm | iex` will not work), extract, then in **Administrator** PowerShell:

```powershell
cd path\to\grokpc-agent-main
Set-ExecutionPolicy -Scope Process Bypass
.\windows\install.ps1
```

Leave the laptop plugged in and set Windows not to sleep on AC power. Paste the printed trycloudflare URL + `AGENT_TOKEN` into the app Settings.

## Codespaces

Open the repo on GitHub → Code → Codespaces. Details and quota: **[CODESPACES.md](./CODESPACES.md)**.

## VPS

Follow **[SERVER_STEPS.md](./SERVER_STEPS.md)**. Short version on Ubuntu 24.04:

```bash
sudo bash backend/setup_server.sh
# edit /app/agent/.env, start a Cloudflare Tunnel, paste URL + token into the app
```

## Security model

- FastAPI and noVNC bind to `127.0.0.1` only
- Every REST and WebSocket call requires `Authorization: Bearer AGENT_TOKEN`
- CORS is limited to the Workers app + localhost
- WhatsApp / Gmail sends always wait for an in-app (or Telegram) approval

## License

Private repository. All rights reserved.
