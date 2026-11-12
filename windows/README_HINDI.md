# GrokPC apne Windows laptop pe (Hinglish)

Yeh setup tumhare **i5 + 16 GB RAM** Windows laptop pe WSL2 + Ubuntu 24.04 me agent chalata hai. Paisa nahi lagta. Laptop **charge pe** rakho aur sleep band rakho.

App pehle se live hai: **https://grokpc-agent.simple-sooraj.workers.dev**

Private repo hai, isliye `irm ... | iex` **kaam nahi karega**. ZIP download karo.

---

## Ek baar ka setup

1. Laptop charger lagaao. Windows Settings → System → Power → **When plugged in, put my device to sleep = Never**.
2. Browser me GitHub pe login karke repo kholo: [Soorajkushwaha/grokpc-agent](https://github.com/Soorajkushwaha/grokpc-agent)
3. Green **Code** button → **Download ZIP**. ZIP extract karo (jaise `Downloads\grokpc-agent-main`).
4. Start menu me **Windows PowerShell** dhoondo → right-click → **Run as administrator**.
5. Yeh commands chalao (path apna extract folder se badalna):

```powershell
cd $env:USERPROFILE\Downloads\grokpc-agent-main
Set-ExecutionPolicy -Scope Process Bypass
.\windows\install.ps1
```

6. Pehli baar Windows **reboot** maang sakta hai (WSL enable karne ke liye). 20 second me khud restart hoga. Login ke baad setup **khud continue** karegi. Agar na ho, step 4–5 dubara chalao.
7. 10–20 minute lagenge (Ubuntu + Python + Chromium). End me **Backend URL**, **noVNC URL**, aur **AGENT_TOKEN** dikhega.
8. Phone ya PC pe app kholo → **Settings**:
   - Backend URL = `https://xxxx.trycloudflare.com` (jo script ne diya)
   - Token = `AGENT_TOKEN`
   - Optional: noVNC URL = dusri trycloudflare link + `/vnc.html`
9. DeepSeek key add karo (agent ko dimaag chahiye):

```powershell
wsl -d Ubuntu-24.04 -u root -- nano /app/agent/.env
```

`DEEPSEEK_API_KEY=...` likho, Ctrl+O, Enter, Ctrl+X. Phir:

```powershell
wsl -d Ubuntu-24.04 -u root -- systemctl restart grokpc-agent
```

Gemini TTS optional hai. WhatsApp/Telegram hataya ja chuka hai — ab focus video production pe hai.

---

## Roz ka use

- Laptop **on + plugged in** raho. Sleep mat hone do. Lid band karoge toh kaam ruk sakta hai.
- Windows start hote hi Task Scheduler WSL aur services start karegi.
- Tunnel URL **badal sakti hai** (quick tunnel). Naya URL dekhne ke liye:

```powershell
wsl -d Ubuntu-24.04 -u root -- bash /app/agent/show_urls.sh
```

Ya: `%LOCALAPPDATA%\GrokPC\start-grokpc.ps1`

Nayi URL Settings me dubara paste karo.

---

## Optional: named Cloudflare tunnel (URL same rehti hai)

Quick tunnel har restart pe nayi URL deta hai. Agar tumhare paas Cloudflare account + koi domain ho, named tunnel laga sakte ho:

1. [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) me ek tunnel banao, jaise `grokpc`.
2. Ubuntu me `/etc/cloudflared/config.yml` (example):

```yaml
tunnel: YOUR_TUNNEL_ID
credentials-file: /etc/cloudflared/YOUR_TUNNEL_ID.json
ingress:
  - hostname: grokpc-api.YOURDOMAIN.com
    service: http://127.0.0.1:8000
  - hostname: grokpc-vnc.YOURDOMAIN.com
    service: http://127.0.0.1:6080
  - service: http_status:404
```

3. `sudo cloudflared service install` (ya systemd unit) aur DNS CNAME Cloudflare pe point karo.
4. Quick tunnels band: `sudo systemctl disable --now grokpc-tunnel grokpc-tunnel-vnc`
5. App Settings me yeh stable URLs paste karo.

Domain na ho toh quick tunnel theek hai — sirf URL update karte rahna.

---

## Problem ho toh

- **Script Admin nahi chal rahi:** PowerShell “Run as administrator” se kholo.
- **Ubuntu install fail:** Microsoft Store se “Ubuntu 24.04” install karke `install.ps1` dubara chalao.
- **Services nahi chali:** `wsl -d Ubuntu-24.04 -u root -- systemctl status grokpc-agent grokpc-desktop`
- **URL nahi dikhi:** thodi der wait, phir `show_urls.sh`. Internet chahiye (Cloudflare).
- **Laptop so gaya:** Power settings check karo; script plugged-in sleep already “Never” karti hai.

Logs: `%LOCALAPPDATA%\GrokPC\install.log`

---

## Video studio (Phase 1) — update ke baad

Laptop pe WSL agent **pehle se chal raha hai**. Naya code aane ke baad (files `/app/agent` me copy + `systemctl restart grokpc-agent`) app me 4 simple screens dikhenge: **Home, Videos, Screen, Settings**.

### Nayi video kaise bane

1. App me **Home** → channel chuno → topic likho → **Nayi Video Banao**.
2. Agent kahani (ChatGPT, ya DeepSeek fallback), awaz (gTTS), aur FFmpeg se MP4 banata hai.
3. **Videos** tab me steps dikhte hain. File `/data/outputs` (WSL) me save hoti hai.
4. **Screen** tab me purana “YouTube kholo” wala browser agent ab bhi kaam karta hai.

### Ek baar ke logins (noVNC)

Screen tab me noVNC kholo, in sites pe **khud** login karo (profile save rehti hai):

- **chatgpt.com** — story/prompt plan (Phase 1)
- Baad me Phase 2: aistudio.google.com, gemini.google.com, grok.com, studio.youtube.com

### CapCut helper (optional, admin nahi)

CapCut sirf Windows pe chalta hai. FFmpeg ke bina bhi video ban jayegi; helper se CapCut khulta hai aur media `Videos\GrokPC\import` me aa jati hai. Poora auto-edit CapCut me reliable nahi (koi API nahi).

```powershell
# Python 3.10+ chahiye (user-scope theek):  winget install Python.Python.3.12 --scope user
# CapCut Windows pe install karo, phir (normal PowerShell, Administrator nahi):
cd path\to\grokpc-agent-main
Set-ExecutionPolicy -Scope Process Bypass
.\windows\desktop_helper\install-helper.ps1
```

Details: [desktop_helper/README.md](./desktop_helper/README.md).

### Phase 2 abhi band

Veo / Grok Imagine, YouTube upload, autopilot (idle pe khud kaam) — flags default **OFF**. Tablet setup baad me.
