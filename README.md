# Ofek · אופק

A quiet, bilingual (Hebrew/English) journaling companion PWA — AI chat for daily check-ins, plus History and Insights tabs. Merges the ideas behind three earlier projects (Serenity, Keepsake, Wellness Journal) into one app built around a single signature: mood is mapped to a horizon-color gradient (night indigo → sky blue → dawn gold) that's used consistently in the mood picker, the header ribbon, the History timeline, and the Insights chart.

Live: https://gefenrose.github.io/ofek/

## Structure

- `index.html` — the whole app (HTML/CSS/JS, single file)
- `manifest.webmanifest`, `sw.js`, `icon-*.png` — PWA install support
- `ofek-ai-override.js` — runtime AI routing/settings patch injected by the service worker
- `worker/worker.js` — Cloudflare Worker AI proxy
- `worker/wrangler.toml` — Worker deployment config

## AI backend

Ofek now routes AI requests through a dedicated Worker, intended to be deployed as:

```text
https://ofek-api.gefenrose.workers.dev
```

The Worker supports two modes:

1. **Default Ofek mode** — uses the Worker secret `GROQ_API_KEY` and Groq's `llama-3.3-70b-versatile`, with `llama-3.1-8b-instant` as a fallback.
2. **Bring your own API key mode** — users can enter their own Groq, OpenAI, or OpenRouter key in Settings. The key is stored locally on that device and sent per request through the Worker. It is not committed to the repo and is not stored by the Worker.

Deploy from the worker folder:

```bash
cd worker
npx wrangler login
npx wrangler deploy
npx wrangler secret put GROQ_API_KEY
```

The Worker health check is available at the Worker root URL and returns whether the default Groq secret is configured.

## Storage

Entries and profile live in `localStorage` for now (key `ofek_state_v1`). AI user-key settings live separately in `localStorage` under `ofek_ai_settings_v1`. No full cloud sync yet — that's a reasonable next step if cross-device history matters.
