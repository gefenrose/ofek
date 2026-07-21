# Ofek architecture

Ofek is a static bilingual PWA. The former single-file application and runtime bridge have been removed; the public document now loads focused assets directly.

## File map

```text
/
├─ index.html                 # Semantic app markup and document metadata
├─ manifest.webmanifest       # Install metadata and icons
├─ sw.js                      # Offline navigation and same-origin asset cache
├─ src/
│  ├─ css/app.css             # Application styles and responsive layouts
│  └─ js/
│     ├─ theme.js             # Pre-paint theme preference
│     ├─ storage.js           # IndexedDB persistence and migration
│     ├─ a11y.js              # Dialog semantics, focus trap, focus restoration
│     ├─ i18n.js              # Hebrew/English copy and flow label maps
│     ├─ image-utils.js        # Image validation, resize, and compression
│     ├─ cloud-sync.js         # Optional Google Drive app-data synchronization
│     ├─ screen-lock.js        # PIN and platform-biometric screen lock
│     ├─ data-transfer.js      # JSON backup export and validated import
│     ├─ ai-settings.js       # BYOK settings and request routing
│     ├─ daily-summaries.js    # Cached whole-day AI summaries
│     └─ app.js               # App orchestration, journal, history, and habits
└─ worker/
   ├─ worker.js               # Stateless BYOK AI proxy
   └─ wrangler.toml           # Worker deployment configuration
```

## Data and privacy

- Journal state is stored in IndexedDB. The old `ofek_state_v1` localStorage value is migrated once and removed after a successful IndexedDB write.
- Theme and language preferences are stored separately in `ofek_prefs_v1` so the theme can be applied before app startup.
- API keys are session-only by default. Persistent storage requires an explicit “remember” choice and can be cleared from Settings.
- The app lock is a local screen lock. PBKDF2 slows offline PIN guessing, but journal records are not encrypted at rest; the UI states this explicitly.
- Google Drive sync uses the user's authenticated app-data folder and remains optional.

## Reliability rules

1. Persistence errors must be visible; never swallow a failed journal write.
2. Service-worker asset failures must never fall back to HTML. Only navigation requests receive the app shell.
3. Closed sheets remain `inert` and hidden from the accessibility tree.
4. The Worker accepts only allow-listed providers, bounded request sizes, known message roles, and valid model identifiers.
5. Feature modules receive dependencies through small `create`/`bind` APIs. Avoid hidden cross-module globals.
6. New functionality should be added in a focused module instead of growing `app.js` indefinitely.
