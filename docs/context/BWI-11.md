# BWI-11: Show app version in Settings window
- Changed: Settings window shows the app version.
- Where: `src/main.js` (passes version), `src/renderer/settings.html` (label), `src/renderer/settings.js` (fills it in). Commit a6b9722.
- Tested: no dedicated script; check by opening Settings.
- Gotchas: version comes from package.json via main process, so bump it there.
- Open: no automated test.
