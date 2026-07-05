# Ofek architecture

Ofek is a single-file PWA. The public entry point contains the full app.

## File map

```text
/
├─ index.html                 # Full app — HTML, CSS, and JS in one file
├─ manifest.webmanifest       # PWA manifest
├─ sw.js                      # Service worker / cache / routing
├─ assets/
│  └─ icons/                  # App icons (192, 512, apple-touch-icon)
├─ src/
│  └─ js/
│     └─ ai-settings.js       # BYOK-only AI settings and request routing
└─ worker/
   ├─ worker.js               # BYOK-only AI proxy (Cloudflare Worker)
   └─ wrangler.toml           # Cloudflare Worker config
```

## Rules going forward

1. **App code lives in `index.html`.** HTML structure, CSS, and JS are co-located in a single file.
2. **`src/js/ai-settings.js` is the one exception.** It handles BYOK AI routing and is loaded via a `<script defer>` tag so it can be updated independently.
3. **Keep AI logic BYOK-only.** Ofek should never include an app-owned Groq/OpenAI/OpenRouter key.
4. **Keep the Worker stateless.** It forwards user keys per request and does not persist them.

## AI architecture

```text
Ofek PWA
  ↓ user enters provider/model/API key in Settings
Ofek Worker
  ↓ forwards request only for this call
Groq / OpenAI / OpenRouter
```

No default app-owned key exists. If the user does not enter a key, AI features fail gracefully while journaling continues locally.
