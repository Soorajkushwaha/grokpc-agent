# GrokPC on GitHub Codespaces (backup / testing)

Yeh **24/7 server nahi** hai. Short tests aur jab laptop off ho, tab ke liye theek hai. Primary setup abhi bhi tumhara Windows laptop hai (`windows/README_HINDI.md`).

## Kaise kholo

1. GitHub pe repo [Soorajkushwaha/grokpc-agent](https://github.com/Soorajkushwaha/grokpc-agent) kholo (login zaroori, private repo).
2. Green **Code** → **Codespaces** → **Create codespace on main**.
3. Machine prompt aaye toh **4-core / 16 GB** choose karo (devcontainer `hostRequirements` yahi hint karta hai). Chhota machine bhi chal sakta hai, tight rahega.
4. Pehli baar `post-create` 10–20 min le sakta hai (apt + Python + Chromium + cloudflared).
5. Terminal me URL + token dikhega, ya chalao:

```bash
sudo bash /app/agent/show_urls.sh
```

6. App Settings me **trycloudflare** Backend URL + `AGENT_TOKEN` paste karo.
7. `/app/agent/.env` me `DEEPSEEK_API_KEY` add karke stack restart:

```bash
sudo bash /app/agent/start_stack.sh
```

## Kyun tunnel, port-forward nahi?

devcontainer ports **8000** aur **6080** ko **private** forward karta hai. Codespaces URLs (`*.app.github.dev`) **GitHub login** maangte hain, isliye phone PWA unhe seedha backend nahi bana sakti. Isliye Codespace ke andar bhi Cloudflare **quick tunnel** chalta hai.

## Official free quota (personal accounts, Nov 2026)

Source (loaded): [GitHub Codespaces billing](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces)

| Plan | Compute / month | Storage / month |
| --- | --- | --- |
| GitHub Free (personal) | **120 core hours** | **15 GB-month** |
| GitHub Pro | 180 core hours | 20 GB-month |

4-core machine ka multiplier **4** hai, isliye Free pe roughly **30 clock hours / month** (120 ÷ 4). 2-core pe ~60 hours. Organization plans me yeh free quota **nahi** milti.

Payment method na ho aur quota khatam ho jaye toh naya / resume **block** ho jata hai, agle billing cycle tak. ([same billing doc](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces))

Included usage 24/7 ke liye kaafi **nahi**. Agent + tunnel terminal output idle timer ko reset kar sakte hain, isliye use ke baad Codespace **Stop** karo, warna quota jaldi khatam hogi.

## Limits (official)

Sources: [idle timeout](https://docs.github.com/en/codespaces/setting-your-user-preferences/setting-your-timeout-period-for-github-codespaces), [lifecycle](https://docs.github.com/en/codespaces/about-codespaces/understanding-the-codespace-lifecycle)

- **Idle timeout:** default **30 minutes** (user setting 5–240 minutes). Typing, mouse, ya terminal input/output timer reset karte hain.
- **Maximum lifetime:** **12 hours**, idle setting se independent. Stop + restart karke continue kar sakte ho; data save rehta hai.
- **Stop vs delete:** Stop pe running processes band, files / Chromium profile **reh jaate hain** (storage bill hota hai). **Delete** pe profile aur `/data/chrome_profile` **ud jaate hain**. Default retention: 30 din inactive ke baad auto-delete.
- Browser tab band karna Codespace ko **stop nahi** karta — woh chalta rehta hai aur compute khapata hai.
- Rebuild `/workspaces` ke bahar ki cheezein mita sakta hai. Chrome profile installer `/data/chrome_profile` me rakhta hai, jo rebuild pe ja sakta hai. Lamba kaam Windows laptop ya VPS pe karo.

## Machine hint

`hostRequirements` 4-core / 16 GB maangta hai. Free account pe yeh size available ho bhi sakta hai, nahi bhi. Jo mile use karo; quota core-hours se kat'ti hai, isliye bada machine jaldi quota khaata hai.
