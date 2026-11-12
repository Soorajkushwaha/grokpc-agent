# GrokPC Windows desktop helper (Phase 1)

CapCut ka Linux build nahi hai, isliye yeh chhota Python service **Windows session** me chalta hai (jo user logged in hai). Admin rights nahi chahiye.

Yeh helper:

- `127.0.0.1:8765` pe bound hai (LAN pe open nahi)
- Bearer token = WSL ka `AGENT_TOKEN`
- Screenshot, mouse/keyboard, CapCut launch
- Media ko `%USERPROFILE%\Videos\GrokPC\import` me copy karta hai
- `GetLastInputInfo` se idle time (Phase 2 autopilot ke liye)

**Limit (imandaari se):** CapCut ka koi official API nahi. Timeline edit vision-loop se try ho sakti hai, lekin UI change hone par toot jayegi. Isliye agent **hamesha FFmpeg se ek reliable final MP4** bhi banata hai. CapCut me review optional hai.

## Install (no admin)

1. Windows pe **Python 3.10+** (user-scope theek hai): `winget install Python.Python.3.12 --scope user`
2. **CapCut** Windows pe install karo (free desktop app).
3. PowerShell (normal, Administrator nahi):

```powershell
cd path\to\grokpc-agent-main
Set-ExecutionPolicy -Scope Process Bypass
.\windows\desktop_helper\install-helper.ps1
```

Login pe Task Scheduler helper start karega. WSL agent `http://127.0.0.1:8765` use karta hai (Windows 11 localhost forwarding pehle se on hai).

Agar token WSL se na mile, `%LOCALAPPDATA%\GrokPC\helper.env` me `GROKPC_HELPER_TOKEN=` wahi value daalo jo `/app/agent/.env` ke `AGENT_TOKEN` me hai. Token chat me mat bhejna.
