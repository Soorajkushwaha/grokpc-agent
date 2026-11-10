# GrokPC Agent

Mobile control center + self-hosted Ubuntu backend for a personal browser agent.

- **Frontend** (`frontend/`): Vite + React PWA, deployed at [https://grokpc-agent.simple-sooraj.workers.dev](https://grokpc-agent.simple-sooraj.workers.dev)
- **Backend** (`backend/`): FastAPI + Playwright vision loop (DeepSeek Flash, Gemini fallback), FFmpeg + gTTS, optional Telegram approvals

The backend runs on **any Ubuntu 24.04 VPS** (x86_64 or ARM64). A 4 GB RAM plan is enough (the installer creates a swapfile and uses a light IceWM desktop). Oracle Always Free is optional if you can get an Ampere A1 VM.

## Quick start (frontend)

```bash
cd frontend
npm install
npm run dev
```

Settings stores only the Cloudflare Tunnel URL and `AGENT_TOKEN`. API keys never leave the VPS.

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
