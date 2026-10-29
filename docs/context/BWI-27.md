# BWI-27: Per-ticket audit trail with text export
- Changed: each ticket has an audit trail view and can be exported as text.
- Where: `src/engine.js` (~57 lines), `src/main.js` (export handler), `src/preload.js`, `src/renderer/app.js` / `app.html`. Commit 19d0650.
- Tested: `scripts/test-audit-trail.js`.
- Gotchas: export goes through main process IPC, so renderer changes need a matching preload entry.
- Open: none known.
