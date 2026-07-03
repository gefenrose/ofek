# Ofek · אופק

A quiet, bilingual (Hebrew/English) journaling companion PWA — AI chat for daily check-ins, plus History and Insights tabs. Merges the ideas behind three earlier projects (Serenity, Keepsake, Wellness Journal) into one app built around a single signature: mood is mapped to a horizon-color gradient (night indigo → sky blue → dawn gold) that's used consistently in the mood picker, the header ribbon, the History timeline, and the Insights chart.

Live: https://gefenrose.github.io/ofek/

## Structure

Ofek has been split out of the original single-file entry point:

- `index.html` — small public app shell
- `styles.css` — shell/loading styles
- `app.js` — bootstrapper that loads the preserved app source
- `legacy-index.html` — preserved copy of the former monolithic app while the larger CSS/JS migration continues
- `manifest.webmanifest`, `sw.js`, `icon-*.png` — PWA install/offline support
- `ofek-ai-override.js` — BYOK-only AI routing/settings patch
- `worker/worker.js` — Cloudflare Worker AI proxy
- `worker/wrangler.toml` — Worker deployment config

This keeps the live app safe while making `index.html` maintainable. The next cleanup step is to gradually move the CSS and JavaScript out of `legacy-index.html` into dedicated modules instead of loading the preserved source.

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
