# BWI-27: Per-ticket audit trail with text export

**What changed:** Each task records status, assignee, QA and retry events (time and actor). The task drawer lists them newest first, with an "Export as text" button.
**Where:** `src/engine.js` (`logAudit`, `normAudit`, `MAX_AUDIT`, `t.audit` in `normTask`), `src/main.js` (export handler), `src/preload.js`, `src/renderer/app.html` and `app.js`.
**Testing:** `scripts/test-audit-trail.js` (86 lines).
**Gotchas:** The engine owns the trail. UI saves cannot erase or rewrite it. The audit is capped at `MAX_AUDIT` entries, so old ones drop. Actors are strings such as 'You', 'Foreman' and (since BWI-37) 'PM'. New code paths that change status should call `logAudit`.
**Open questions:** Not every status change path was checked for `logAudit`, for example drag-and-drop and Foreman `update_task`. The BWI-25 override is not logged.
