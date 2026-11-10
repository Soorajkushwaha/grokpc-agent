# GrokPC backend — kisi bhi Ubuntu 24.04 VPS pe

App already live hai:

**https://grokpc-agent.simple-sooraj.workers.dev**

Backend **tumhare VPS** pe chalega (x86_64 ya ARM64, Ubuntu 24.04). API keys sirf VM ke `/app/agent/.env` me rahengi.

**Minimum:** 2 vCPU, **4 GB RAM**, 20+ GB disk, public IPv4, SSH. 4 GB pe installer khud **2 GB swapfile**, halka **IceWM** desktop, aur tight Chromium flags lagaata hai.

Oracle Always Free optional hai — card / capacity na ho toh koi bhi cheap Ubuntu VPS theek hai. Oracle ke notes ke liye neeche [Optional: Oracle Always Free](#optional-oracle-always-free) dekho.

---

## 1) Ubuntu 24.04 VPS lo

Koi bhi provider (Hetzner, DigitalOcean, Contabo, Oracle, ghar ka box, …) jab tak image **Ubuntu 24.04 LTS** ho.

- CPU: **x86_64 (amd64)** ya **ARM64 (aarch64)** — dono supported
- Plan: **4 GB RAM** recommended (2 GB pe bhi swap se chal sakta hai, tight rahega)
- Disk: kam se kam 20 GB (Playwright Chromium + profile ke liye)
- Firewall / security group: **sirf SSH port 22** open rakho. 6080 aur 8000 **mat** kholo — app localhost + Cloudflare Tunnel se chalegi.

Ubuntu 22.04 / 20.04 official support nahi — 24.04 choose karo.

SSH key save kar lo. User aksar `ubuntu` ya `root` hota hai (`root` ho toh pehle ek sudo user bana lo).

---

## 2) Windows PowerShell se SSH

```powershell
ssh -i "C:\Users\YOU\Downloads\your-ssh-key.key" ubuntu@YOUR_VPS_IP
```

Pehli baar `yes`. User provider ke hisaab se `ubuntu`, `debian`, ya `root` ho sakta hai.

Permission error aaye toh:

```powershell
icacls "C:\Users\YOU\Downloads\your-ssh-key.key" /inheritance:r /grant:r "$($env:USERNAME):(R)"
```

---

## 3) Code VPS pe kaise laye (private repo)

Repo private hai: **https://github.com/Soorajkushwaha/grokpc-agent**

### Asaan option A — Windows se folder/ZIP bhejo (token ki zaroorat nahi)

Laptop pe (repo already ho, ya GitHub → Code → Download ZIP):

```powershell
scp -i "C:\Users\YOU\Downloads\your-ssh-key.key" -r C:\path\to\grokpc-agent ubuntu@YOUR_VPS_IP:~/grokpc-agent
```

Ya tar:

```powershell
tar -czf grokpc-agent.tgz grokpc-agent
scp -i "C:\Users\YOU\Downloads\your-ssh-key.key" grokpc-agent.tgz ubuntu@YOUR_VPS_IP:~/
```

VPS pe:

```bash
cd ~
tar -xzf grokpc-agent.tgz
cd grokpc-agent
```

### Option B — VPS pe `gh` se clone

```bash
sudo apt-get update && sudo apt-get install -y gh git
gh auth login    # GitHub account, HTTPS, token paste
gh repo clone Soorajkushwaha/grokpc-agent
cd grokpc-agent
```

Token banate waqt sirf **repo read** do. Clone ke baad token revoke kar sakte ho.

---

## 4) Setup script

```bash
sudo bash backend/setup_server.sh
```

Yeh script:

- Architecture detect karti hai (x86_64 / aarch64)
- RAM < 6 GB ho toh **2 GB swapfile**, 1280×720 viewport, tight Chromium flags
- Halka desktop: **Xvfb + IceWM + x11vnc + noVNC** (full XFCE nahi)
- Python venv, Playwright Chromium, systemd units `grokpc-desktop` + `grokpc-agent`
- **AGENT_TOKEN** aur **VNC password** generate karke **ek baar** print karti hai — **save kar lo**
- API sirf `127.0.0.1:8000` pe sunti hai, noVNC sirf `127.0.0.1:6080`

Optional (4 GB pe bhaari padega):

```bash
sudo bash backend/setup_server.sh --with-kdenlive
```

Phir keys daalo:

```bash
sudo nano /app/agent/.env
```

Kam se kam `DEEPSEEK_API_KEY=` bharo (https://platform.deepseek.com/). Gemini / Telegram optional.

```bash
sudo systemctl restart grokpc-agent
sudo systemctl status grokpc-agent grokpc-desktop
```

---

## 5) Cloudflare Tunnel

### Quick tunnel (test, URL restart pe badal jati hai)

```bash
cloudflared tunnel --url http://127.0.0.1:8000
```

Ek `https://xxxx.trycloudflare.com` milega — yeh **backend URL** hai.

noVNC ke liye app pehle same URL + `/novnc/vnc.html?token=AGENT_TOKEN` try karti hai. Kaam na kare toh doosri terminal:

```bash
cloudflared tunnel --url http://127.0.0.1:6080
```

Yeh dusri URL Settings me “noVNC URL (optional)” me paste karo (`/vnc.html` ke saath).

SSH band ho toh quick tunnel bhi band. `tmux` / `screen` me chalao, ya named tunnel use karo.

### Named tunnel (recommended, free, URL stable)

Agar Cloudflare pe koi domain hai:

1. [dash.cloudflare.com](https://dash.cloudflare.com) → Zero Trust → Networks → Tunnels → Create
2. Dashboard wala `cloudflared` token VPS pe chalao
3. Ingress:

   - `https://grokpc-api.YOURDOMAIN.com` → `http://127.0.0.1:8000`
   - `https://grokpc-vnc.YOURDOMAIN.com` → `http://127.0.0.1:6080`

4. Ye stable URLs Settings me paste karo.

Domain nahi hai toh quick tunnel kaafi hai; reconnect pe naya URL app me update karna padega.

---

## 6) App me connect

1. Phone/laptop: **https://grokpc-agent.simple-sooraj.workers.dev**
2. Optional: browser menu → **Add to Home Screen**
3. Settings (gear):
   - Tunnel URL
   - `AGENT_TOKEN`
   - Demo mode **off**
   - Save

Health “Live / API up” dikhna chahiye.

---

## 7) Ek baar WhatsApp / Gmail login

1. Live noVNC kholo (VNC password wahi jo setup ne print kiya)
2. Chrome / open window me WhatsApp Web ka QR phone se scan karo
3. Gmail / Google account me login karo

Cookies `/data/chrome_profile` me save rehti hain.

---

## 8) Optional: Google Drive (`rclone`)

```bash
rclone config
# remote ka naam exactly:  gdrive
sudo systemctl enable --now rclone-gdrive
```

Mount ho jaye toh videos `/mnt/gdrive/Vids_Automation` me, warna `/data/outputs`.

---

## 9) Checks / trouble

```bash
free -h                                 # 4 GB box pe swap dikhna chahiye
ss -lntp | grep -E '8000|6080|5900'     # sirf 127.0.0.1
journalctl -u grokpc-agent -e
curl -sS -H "Authorization: Bearer YOUR_TOKEN" http://127.0.0.1:8000/api/health
```

Agent start na ho: `.env` me `AGENT_TOKEN` check karo. Desktop na ho: `journalctl -u grokpc-desktop -e`.

RAM tight ho: `.env` me `LOW_MEMORY=1`, `VIEWPORT_WIDTH=1280`, `VIEWPORT_HEIGHT=720`, phir `sudo systemctl restart grokpc-agent grokpc-desktop`.

---

## Cost (typical, 2026)

| Cheez | Estimate | Source |
|---|---|---|
| VPS 4 GB (provider ke hisaab se) | aksar ~$4–8 / month; koi-koi free tier | tumhara provider |
| Oracle A1 2 OCPU / 12 GB in Always Free | **$0** if you stay in free quota | neeche Oracle section |
| Cloudflare Workers static app + tunnel | **$0** on the free plan for this usage | Cloudflare Workers / Tunnel docs |
| DeepSeek Flash vision | Peak cache-miss **$0.30 / 1M input**, **$1.20 / 1M output** (off-peak half) | https://api-docs.deepseek.com/quick_start/pricing |
| Gemini Flash fallback | paid-tier rates if you exceed the free tier | https://ai.google.dev/gemini-api/docs/pricing |
| gTTS voice (default) | **$0** | no paid API |
| Optional Gemini TTS (`USE_GEMINI_TTS=1`, `gemini-3.8-flash-lite-tts`) | ~**$0.00225 / 10s** audio (3.8 Flash TTS standard, through 2026-12-31) | https://ai.google.dev/gemini-api/docs/pricing |

App ke Budget tab me real usage se INR estimate milta hai (`USD_INR_RATE` `.env` me).

---

## Optional: Oracle Always Free

Card, identity check, ya “out of capacity” ki wajah se Oracle na mile toh koi baat nahi — upar wala generic VPS path use karo.

Agar Oracle try karna ho:

1. [cloud.oracle.com](https://cloud.oracle.com) pe sign up. **Home region** baad me change nahi hota. India: aksar `ap-mumbai-1` ya `ap-hyderabad-1`.
2. Kai accounts ko credit card / PAYG “upgrade” chahiye tabhi VM banti hai. Iska matlab automatic bill nahi. **Sirf VM.Standard.A1.Flex (Ampere)** lo, extra Block Volume / paid IP / load balancer mat add karo. Billing me **$1 budget alarm** laga do.
3. “Out of capacity” common hai, especially Mumbai. Try dusra Availability Domain, doosra time, ya chhoti shape (1 OCPU / 6 GB) baad me edit.
4. Free quota typical: home region me **upto 4 ARM OCPU + 24 GB RAM**. 2 OCPU / 12 GB iska aadha hai.
5. Image: **Ubuntu 24.04 aarch64**. Shape: Ampere → **VM.Standard.A1.Flex**. Public IP theek hai; NSG/security list me **sirf port 22**.
6. SSH same hai:

```powershell
ssh -i "C:\Users\YOU\Downloads\oracle-ssh.key" ubuntu@YOUR_ORACLE_IP
```

Uske baad **section 3 se aage same steps** — `sudo bash backend/setup_server.sh`. Script ARM64 ko detect kar leti hai. 12 GB RAM pe low-memory mode off rahega (1440×720 nahi, 1440×900).
