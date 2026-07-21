# Ofek · אופק

A quiet, bilingual (Hebrew/English) journaling companion PWA — AI chat for daily check-ins, plus History and Insights tabs. Merges the ideas behind three earlier projects (Serenity, Keepsake, Wellness Journal) into one app built around a single signature: mood is mapped to a horizon-color gradient (night indigo → sky blue → dawn gold) that's used consistently in the mood picker, the header ribbon, and the History timeline.

Live: https://gefenrose.github.io/ofek/

## Structure

Ofek now uses direct, static app assets:

- `index.html` — semantic app markup and metadata
- `src/css/app.css` — application styles
- `src/js/app.js` — journaling, history, habits, sync, and lock behavior
- `src/js/storage.js` — IndexedDB persistence and localStorage migration
- `src/js/a11y.js` — dialog focus and accessibility behavior
- `src/js/i18n.js` — bilingual copy and labels
- `src/js/image-utils.js` — journal image processing
- `src/js/cloud-sync.js` — optional Google Drive synchronization
- `src/js/screen-lock.js` — PIN and biometric screen lock
- `src/js/data-transfer.js` — backup export/import
- `src/js/ai-settings.js` — BYOK-only AI routing and settings
- `src/js/daily-summaries.js` — cached AI summaries generated from every entry in a day
- `manifest.webmanifest`, `sw.js`, `icon-*.png` — PWA install/offline support
- `worker/worker.js` — Cloudflare Worker AI proxy
- `worker/wrangler.toml` — Worker deployment config
- `ARCHITECTURE.md` — architecture rules and migration plan

New browser behavior belongs in focused modules under `src/js/`; styles belong under `src/css/`.

## AI backend

Ofek is now **bring-your-own-key only**. There is no app-owned AI provider key in the frontend or Worker.

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
- Anthropic
- OpenRouter
- Gemini

The user's key is kept in `sessionStorage` by default and is sent only per request through the Ofek Worker. Users can explicitly opt into remembering it on the device; the Worker does not store user keys.

Deploy from the worker folder:

```bash
cd worker
npx wrangler login
npx wrangler deploy
```

No `GROQ_API_KEY` secret is required anymore.

The Worker health check is available at the Worker root URL and reports `mode: "bring-your-own-key-only"` and `hasAppOwnedApiKey: false`.

## Storage

Entries, profile, and photos live in IndexedDB. Existing `ofek_state_v1` localStorage data migrates automatically on first load. Small theme/language preferences remain in localStorage, while AI keys default to session-only storage. Google Drive app-data sync remains optional.
