# Ofek architecture

Ofek started as a single-file PWA. The repo is now organized so the public entry point is small and new code has a clear place to live.

## Current file map

```text
/
├─ index.html                 # Thin public shell only
├─ styles.css                 # Shell/loading styles
├─ app.js                     # Bootstrap bridge into the preserved app
├─ ofek-ai-override.js        # BYOK-only AI settings + request routing patch
├─ manifest.webmanifest       # PWA manifest
├─ sw.js                      # Service worker/cache/routing
├─ icon-192.png
├─ icon-512.png
├─ src/
│  └─ legacy/
│     └─ monolith.html        # Preserved former single-file app
└─ worker/
   ├─ worker.js               # BYOK-only AI proxy
   └─ wrangler.toml           # Cloudflare Worker config
```

## Rules going forward

1. **Do not add new features to `src/legacy/monolith.html`.** It exists to keep the current app working while migration continues.
2. **Use `index.html` only for document metadata and loading top-level scripts/styles.**
3. **Put new browser behavior in modular JS files under `src/js/`.**
4. **Put new styles under `src/css/`.**
5. **Keep AI logic BYOK-only.** Ofek should never include an app-owned Groq/OpenAI/OpenRouter key.
6. **Keep the Worker stateless.** It forwards user keys per request and does not persist them.

## Migration plan

The current `app.js` bridge loads `src/legacy/monolith.html`, copies its styles/body into the shell, then executes its scripts. This is intentionally temporary.

Recommended next steps:

1. Extract the `<style>` block from `src/legacy/monolith.html` into `src/css/app.css`.
2. Extract the inline app script into `src/js/legacy-app.js`.
3. Split `legacy-app.js` into focused modules:
   - `src/js/state.js`
   - `src/js/i18n.js`
   - `src/js/settings.js`
   - `src/js/ai.js`
   - `src/js/history.js`
   - `src/js/habits.js`
   - `src/js/grounding.js`
   - `src/js/main.js`
4. Replace the bridge loader with direct module imports.
5. Delete `src/legacy/monolith.html` only after the app works without it.

## AI architecture

```text
Ofek PWA
  ↓ user enters provider/model/API key in Settings
Ofek Worker
  ↓ forwards request only for this call
Groq / OpenAI / OpenRouter
```

No default app-owned key exists. If the user does not enter a key, AI features should fail gracefully while journaling continues locally.
