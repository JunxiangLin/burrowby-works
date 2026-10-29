# BWI-11: Show app version in Settings window

**What changed:** The Settings window shows the app version.
**Where:** `src/main.js` (passes the version), `src/renderer/settings.html`, `src/renderer/settings.js`. Commit a6b9722 (3 lines).
**Testing:** No automated test (UI text only). Running `npm run check` is what exposed a different bug (see gotchas).
**Gotchas:** While doing this ticket, `npm run check` failed inside the worker sandbox. The check's temporary bare repo inherited the worker's `GIT_CONFIG_*` overrides. It was fixed separately in acc36f2 (check now clears those variables) and the README safety claims were corrected. Not part of BWI-11 itself.
**Open questions:** Was the version read from `package.json` or `app.getVersion()`? Check `src/main.js` before changing it. Not verified in a running Electron window.
