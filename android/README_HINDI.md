# GrokPC Redmi Pad / Android tablet pe (Termux)

Yeh setup **Redmi Pad 2 Pro 5G** (official Xiaomi India: **8 GB RAM**, Snapdragon 7s Gen 4, ARM64, HyperOS 2, 5G SIM) jaise tablet pe agent chalaata hai. Root nahi chahiye.

App: **https://grokpc-agent.simple-sooraj.workers.dev**

Settings me ab **Laptop / Tablet / VPS** switch hai — tablet ka URL+token alag save hoga, laptop wala nahi mitega.

Private repo hai, isliye `curl` se raw file **nahi** aaegi. ZIP download karo.


> **Phase 2:** Abhi rollout **laptop pehle** hai. Tablet baad me. Is setup se planning / awaz / FFmpeg chal sakta hai, lekin **CapCut-on-Android automate nahi** hota.

---

## Kyun Termux native, Ubuntu proot nahi?

- **Playwright official Android / proot browsers nahi deta** (`Unsupported platform: android` if bundled browsers download hon).
- Termux **x11-repo** me official **Chromium** package hai (aarch64, Nov 2026 index: 157.x). Hum usko `--remote-debugging-port=9222` se start karke Playwright **`connect_over_cdp`** se jodte hain. Fallback: `executable_path` usi Chromium pe.
- **Ubuntu 24.04** proot me Chromium **snap-only** hai; snap proot me reliably nahi chalta.
- Debian bookworm/trixie proot + `.deb` Chromium possible hai, lekin extra distro, zyada RAM, aur Bionic/glibc tension. Native Termux simpler aur official packages (`chromium`, `tigervnc`, `cloudflared`, `python-playwright`) use karta hai.

Official Termux packages (packages.termux.dev, 12 Nov 2026, aarch64): `cloudflared` 2026.10.7 (main), `chromium` + `tigervnc` + `icewm` + `python-playwright` (x11-repo).

Desktop: **TigerVNC + IceWM + noVNC**, 1280×720, localhost only, Cloudflare quick tunnel. Termux:X11 optional hai (tablet screen pe local window); phone PWA ke liye noVNC kaafi hai.

---

## 0) Apps install (Play Store wala Termux MAT lo)

Official sources (Termux wiki: [Installation](https://wiki.termux.com/wiki/Installation), [Termux:Boot](https://wiki.termux.com/wiki/Termux:Boot)):

1. Agar Play Store ka Termux pehle se hai toh **uninstall** karo (saari Termux apps).
2. **Ek hi source** se sab install karo (signature alag hote hain, mix mat karo):

**Recommended: F-Droid** (updates aasan)

- [F-Droid client](https://f-droid.org/) install karo
- [Termux](https://f-droid.org/en/packages/com.termux/)
- [Termux:Boot](https://f-droid.org/en/packages/com.termux.boot/) (autostart — zaroori)
- Optional: [Termux:API](https://f-droid.org/en/packages/com.termux.api/)

**Ya GitHub releases** (same org, same set): [termux-app](https://github.com/termux/termux-app/releases), [termux-boot](https://github.com/termux/termux-boot/releases), optional [termux-api](https://github.com/termux/termux-api/releases).

Play Store wali listing alag fork hai (`termux-play-store`) — packages/add-ons mismatch hote hain. Mat use karo.

---

## 1) Xiaomi / HyperOS settings (warna background me band ho jayega)

Settings me yeh karo (names thode alag ho sakte hain):

1. **Apps → Termux** aur **Termux:Boot**:
   - Autostart / **Auto-start = ON**
   - Battery saver / Battery usage = **No restrictions** (Unrestricted)
   - Battery optimization = **Don't optimize**
2. Recent apps me **Termux ko lock** karo (lock icon / “Lock this app”).
3. Agar option ho: **Memory extension / MIUI / HyperOS optimization** termux ke liye relax, ya “Don’t kill apps” / “Boost speed” se Termux hataao.
4. Tablet **charge pe** rakho. HyperOS me **battery protection / 80% charge limit** on kar lo (battery lambi chalegi; agent raat bhar charger pe reh sakta hai).
5. 5G SIM always-online theek hai. Install ke time **Wi-Fi** better (Chromium package bada hai, ~160 MB+).

Pehli baar **Termux:Boot app ka icon** kholna zaroori hai, warna boot pe script nahi chalegi.

---

## 2) Code tablet pe lao + setup

1. Chrome/Firefox me GitHub login karke repo kholo: [Soorajkushwaha/grokpc-agent](https://github.com/Soorajkushwaha/grokpc-agent)
2. **Code → Download ZIP**. Download complete hone do.
3. Termux kholo, typ karo:

```bash
termux-setup-storage
# Allow / storage permission do
cd ~/storage/downloads
# folder ka naam thoda alag ho sakta hai:
ls | grep -i grokpc
# zip extract:
unzip -o grokpc-agent-main.zip
bash grokpc-agent-main/android/setup_termux.sh
```

10–25 minute lag sakte hain (pehli baar packages). End me **Backend URL**, **noVNC URL**, **AGENT_TOKEN** dikhega.

4. DeepSeek key:

```bash
nano ~/.grokpc/.env
# DEEPSEEK_API_KEY=...  (Ctrl+O, Enter, Ctrl+X)
grokpc-stop
grokpc-start
```

5. Phone/PC pe app → **Settings → Tablet** slot → URL + token paste → Save.
6. Baad me URL dekhne ke liye Termux me: `grokpc-urls`  
   Quick tunnel reboot ke baad **badal sakti hai** — Settings me naya URL paste karo.

Commands: `grokpc-start` · `grokpc-stop` · `grokpc-urls`

---

## Trading charts ke saath

Tablet pe kabhi-kabhi trading charts bhi chalte hain. 8 GB RAM hai, lekin Chromium + charts saath me tight ho sakte hain, aur 5G data tunnel + page load pe lagta hai.

- Charts dekhte waqt lag / hang ho toh Termux me `grokpc-stop` (profile delete nahi hota).
- Charts band hone ke baad `grokpc-start`.
- Agent idle ho aur koi noVNC viewer na ho toh stream nahi chalti; vision screenshots JPEG + low quality pe hain, UI me screenshot flood default off hai.

---

## Known limits

- Yeh official Playwright-on-Android nahi hai — system Chromium + CDP. Kabhi-kabhi Chromium crash / HyperOS kill kar de. Autostart + wake-lock + No restrictions se chance kam.
- `--no-sandbox` zaroori hai (Android pe sandbox namespaces nahi). Sensitive banking isi profile me mat kholo.
- 8 GB me Android + HyperOS + Chromium + agent share hote hain. Lightweight IceWM, 1280×720, tight flags.
- Termux sleep / “app killed” OEM issue ho sakta hai — settings upar wale missing ho toh yahi sabse common reason.
- Wake-lock CPU ko jaagne rakhta hai; charger + 80% limit use karo. Unplugged pe battery jaldi khatam.
- noVNC localhost + Cloudflare tunnel. Public ports nahi kholte.
- Profile `~/.grokpc/chrome_profile` me rehta hai (WhatsApp/Gmail login). `grokpc-stop` ise nahi mitaata. Termux uninstall / clear data se udh jayega.

Logs: `~/.grokpc/logs/`
