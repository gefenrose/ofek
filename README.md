# Ofek · אופק

A quiet, bilingual (Hebrew/English) journaling companion PWA — AI chat for daily check-ins, plus History and Insights tabs. Merges the ideas behind three earlier projects (Serenity, Keepsake, Wellness Journal) into one app built around a single signature: mood is mapped to a horizon-color gradient (night indigo → sky blue → dawn gold) that's used consistently in the mood picker, the header ribbon, the History timeline, and the Insights chart.

Live: https://gefenrose.github.io/ofek/

## Structure

- `index.html` — the whole app (HTML/CSS/JS, single file)
- `manifest.webmanifest`, `sw.js`, `icon-*.png` — PWA install support
- `worker/worker.js` — optional standalone Cloudflare Worker (Gemini 2.5 Flash proxy) if you want Ofek on its own backend instead of reusing `serenity-api`

## AI backend

`index.html` currently points `AI_ENDPOINT` at the existing `serenity-api.gefenrose.workers.dev` worker. Swap that constant to point at `worker/worker.js` (deployed separately via `wrangler deploy`) if you'd rather keep this app's traffic independent.

## Storage

Entries and profile live in `localStorage` for now (key `ofek_state_v1`). No cloud sync yet — that's a reasonable next step if cross-device history matters.
