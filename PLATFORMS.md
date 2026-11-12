# Cheap / no-card platforms for GrokPC (Nov 2026)

Checked **12 Nov 2026** (Asia/Calcutta) official pages se. GrokPC ko chahiye: persistent Chromium profile, long-running Python + Xvfb/noVNC, outbound web browsing, Ubuntu root. Ideal **≥4 GB RAM**; **2 GB + swap** fallback. Budget: **₹100–200/month** ya free, **bina credit card** / **UPI**.

**Seedha jawab:** official lists pe koi verified **4 GB always-on VPS ₹100–200/month** nahi mila. ₹100–200 me sirf **1 GB** plans dikhe (tight). 2 GB ~₹289 se shuru; sahi 4 GB ~₹446–549. Isliye abhi **Windows laptop (₹0)** primary hai, **Codespaces** testing ke liye, VPS baad me jab budget thoda badhe.

Prices below **GST ke pehle** ho sakte hain (India me aksar +18%).

---

## 3 best concrete options

### 1) Apna Windows laptop + WSL2 — ₹0 (primary)

16 GB RAM, persistent profile, outbound browsing tumhare ghar ke net pe, ToS issue nahi. Setup: [`windows/README_HINDI.md`](./windows/README_HINDI.md). Laptop charge pe, sleep band. **Yahi abhi use karo.**

### 2) GitHub Codespaces — free quota, card nahi jab tak quota bache (testing)

Official: [Codespaces billing](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces) (page loaded). GitHub Free personal: **120 core hours + 15 GB-month / month**. 4-core pe ~**30 clock hours**. Idle default 30 min, hard lifetime 12 h. Stop pe files rehti hain, delete pe nahi. Port-forward URLs GitHub login maangte hain — isliye tunnel use karo. Details: [`CODESPACES.md`](./CODESPACES.md).

**24/7 ke liye nahi.** Quota ke baad bina payment method ke block.

### 3) AIC Cloud VPS — UPI, no card required, sabse sasta official always-on

Official pages loaded:

- India (Mumbai): [aiccloud.in/vps-hosting-mumbai](https://aiccloud.in/vps-hosting-mumbai) — **1 GB ₹149/mo**, **2 GB ₹289/mo**, **4 GB ₹549/mo**. UPI (PhonePe / GPay / Paytm / Razorpay), month-to-month, no Year-2 hike. Default shared IP; unhone Cloudflare Tunnel support likha hai (hamare setup se fit).
- Global / USA list: [aiccloud.in/vps](https://aiccloud.in/vps) — title **“from ₹99/mo with 1 GB RAM”**; USA 1 GB plan **$1.10/mo** (~₹99). [aiccloud.in](https://aiccloud.in/) — “No credit card required”, INR via UPI/Razorpay.

**Kaise choose:** budget ≤₹200 ho toh **1 GB (₹149 Mumbai ya ~₹99 USA/EU)** + installer ka swap fallback — **bahut tight** (Chromium + Xvfb). Jo actually chalane layak ho: **2 GB ₹289**. 4 GB ₹549 jab card/budget ho.

Ubuntu 24.04 image unke docs me listed hai. Persistent VPS, root, outbound browsing normally allowed (normal VPS ToS; abuse / scanning mat karna).

---

## Other Indian UPI VPS (official, but above ₹200)

| Provider | Official page (loaded) | Cheapest relevant plan | Fit for GrokPC |
| --- | --- | --- | --- |
| **Getwebup** | [getwebup.in/vps](https://www.getwebup.in/vps) | **2 vCPU / 4 GB / 20 GB from ₹446/mo** (ex-GST), Mumbai or Noida, dedicated IPv4, Ubuntu 24.04 | **Good** 4 GB always-on. INR billing. First-order DigiLocker KYC (PAN + Aadhaar phone). 7-day money-back on first server. |
| **BookMyHost** | [bookmyhost.com/pricing](https://bookmyhost.com/pricing) | **CV2-2-20: 2 GB ₹469/mo**; **CV4-4-40: 4 GB ₹833/mo** (ex-GST). UPI / cards / net banking. **₹200 KYC welcome credit**. Hourly from ₹0.92/hr (2 GB). | 2 GB chal sakta hai + swap. 4 GB mehnga. Credit se kuch din hourly try kar sakte ho. Noida DC. |
| **HostBet** | [clients.hostbet.in Indian VPS](https://clients.hostbet.in/index.php?rp=/store/indian-vps) | **Micro: 2 vCPU / 4 GB / 40 GB NVMe, New Delhi, ₹500/mo** | **Good** 4 GB. Payment page UPI explicitly nahi dikhi; Indian INR store hai — checkout pe UPI confirm karo. |
| **Cantech** | [cantech.in](https://www.cantech.in/) | Homepage **VPS from ₹659/mo** (plan RAM is page pe breakdown nahi tha) | Budget se upar. India DC, KYC on first order. Tab lo jab 4 GB+ chahiye aur yeh plan confirm ho. |

**ServerCheap:** is pass official plan page reliably load / verify nahi hui, isliye yahan recommend nahi.

In sab pe GrokPC **technically fit** hai (real VPS, persistent disk, long-running, browsing normally OK). ₹100–200 target miss karte hain.

---

## Free / cheap cloud tiers — is workload ke liye generally **nahi**

| Platform | Official (loaded) | Card / free? | Persistent profile + 24/7 + browsing? | Verdict |
| --- | --- | --- | --- | --- |
| **GitHub Codespaces** | [billing](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces), [timeout](https://docs.github.com/en/codespaces/setting-your-user-preferences/setting-your-timeout-period-for-github-codespaces), [lifecycle](https://docs.github.com/en/codespaces/about-codespaces/understanding-the-codespace-lifecycle) | No card until free quota used | Stop pe files yes; 12 h cap; idle 30 min; not 24/7 | **Testing only** (option 2) |
| **Google Cloud Shell** | [Quotas and limits](https://docs.cloud.google.com/shell/docs/quotas-limits) (updated 2026-11-05) | Free with Google account | **50 h/week**; session cap **12 h**; **non-interactive 40 min** pe band; only `$HOME` (5 GB) persistent; 120-day inactivity pe home delete. Interactive use only. | **Nahi** — 24/7 agent timeout ho jayega |
| **Gitpod / Ona** | [ona.com billing](https://ona.com/docs/ona/billing/overview) | — | **“Ona Cloud is retired.”** | **Nahi** |
| **Hugging Face Spaces** | [Spaces overview](https://huggingface.co/docs/hub/spaces-overview), [GPU/hardware](https://huggingface.co/docs/hub/spaces-gpus) | CPU Basic hourly **free**, lekin **naya Gradio/Docker Space create karne ke liye paid plan** (PRO). Static free. | CPU Basic **16 GB**, lekin disk **persistent nahi**; free hardware ~**48 h unused** pe sleep. Outbound mostly ports **80/443/8080**. ML demo platform; always-on browser agent ke liye designed nahi. | **Nahi** as 24/7 PC (create ke liye paid + sleep + ephemeral disk) |
| **Koyeb** | [koyeb.com/pricing](https://www.koyeb.com/pricing) | Pro **$29/mo + compute**; scale-to-zero. Clear always-on free CPU 4 GB nahi. | Sleep / paid. Card likely. | **Nahi** is budget me |
| **Render** | [docs.render.com/free](https://docs.render.com/free), [render.com/pricing](https://render.com/pricing) | Hobby $0 + compute; **Free web: 512 MB**, **15 min idle pe spin-down**, local files **ud jaate hain**, Free pe **persistent disk nahi**. Payment: **cards** (Stripe). High **service-initiated outbound** pe Free service suspend ho sakti hai (browsing ke liye risky). | **Nahi** |
| **Railway** | [railway.com/pricing](https://railway.com/pricing) | Free Trial **$5 / 30 days, no card**; Free plan $1 credit but **max 0.5 GB**. Hobby $5 (card). | 0.5 GB pe Chromium nahi. Trial 1 GB / 30 din. 24/7 2–4 GB paid. | Trial short test maybe; **24/7 nahi** bina card |
| **Fly.io** | [docs.fly.io/about/pricing](https://docs.fly.io/about/pricing) | **No free tier.** Trial **$1 / 7 days, no card**; uske baad **credit card required**. Cheapest always-on 256 MB **$2.19/mo**; 2 GB **$13.39/mo**. | Card ke baad technically ho sakta hai, budget/card dono issue. | **Abhi nahi** (card chahiye) |

---

## Recommendation

1. **Abhi:** Windows laptop pe install (`windows/README_HINDI.md`).
2. **Kabhi-kabhi test / laptop off:** Codespaces, quota bakhsh ke.
3. **Jab thoda paisa ho:** AIC Cloud **2 GB ₹289** (UPI). 1 GB ₹149 tabhi jab experiment accept ho. Comfortable 4 GB: **Getwebup ₹446** ya **HostBet ₹500**.
