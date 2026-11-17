# pwa-offline-outbox

PWA con patrón Outbox offline (IndexedDB, Cache API y Background Sync) en JavaScript Vanilla.

## Estructura

```
pwa-offline-outbox/
├── index.html          # UI
├── styles.css
├── db-helper.js        # Mini-wrapper IndexedDB
├── app.js              # Lógica de UI y outbox
├── sw.js               # Service Worker + Background Sync
├── manifest.json
├── icons/              # Iconos PWA
└── README.md
```