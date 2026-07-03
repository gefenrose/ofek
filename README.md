# Ofek · אופק

A quiet, bilingual (Hebrew/English) journaling companion PWA — AI chat for daily check-ins, plus History and Insights tabs. Merges the ideas behind three earlier projects (Serenity, Keepsake, Wellness Journal) into one app built around a single signature: mood is mapped to a horizon-color gradient (night indigo → sky blue → dawn gold) that's used consistently in the mood picker, the header ribbon, the History timeline, and the Insights chart.

Live: https://gefenrose.github.io/ofek/

## Structure

Ofek now uses a cleaned bridge architecture:

- `index.html` — thin public shell only
- `styles.css` — shell/loading styles
- `app.js` — bootstrap bridge into the preserved app source
- `src/legacy/monolith.html` — preserved former single-file app while migration continues
- `ofek-ai-override.js` — BYOK-only AI routing/settings patch
- `manifest.webmanifest`, `sw.js`, `icon-*.png` — PWA install/offline support
- `worker/worker.js` — Cloudflare Worker AI proxy
- `worker/wrangler.toml` — Worker deployment config
- `ARCHITECTURE.md` — architecture rules and migration plan

New code should not be added to `src/legacy/monolith.html`. Use `src/js/` and `src/css/` for new modules/styles as the migration continues.

## AI backend

Ofek is now **bring-your-own-key only**. There is no app-owned Groq/OpenAI/OpenRouter API key in the frontend or Worker.

The Worker is intended to be deployed as:

```text
https://ofek-api.gefenrose.workers.dev
```

Users must enter their own API key in:

```text
Settings → AI connection
```

Supported providers:

- Groq
- OpenAI
- OpenRouter

The user's key is stored locally on that device in `localStorage` under `ofek_ai_settings_v1` and is sent only per request through the Ofek Worker. The Worker does not store user keys.

Deploy from the worker folder:

```bash
cd worker
npx wrangler login
npx wrangler deploy
```

No `GROQ_API_KEY` secret is required anymore.

The Worker health check is available at the Worker root URL and reports `mode: "bring-your-own-key-only"` and `hasAppOwnedApiKey: false`.

## Storage

Entries and profile live in `localStorage` for now (key `ofek_state_v1`). AI user-key settings live separately in `localStorage` under `ofek_ai_settings_v1`. No full cloud sync yet — that's a reasonable next step if cross-device history matters.
