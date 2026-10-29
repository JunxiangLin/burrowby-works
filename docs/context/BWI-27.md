# BWI-27: Per-ticket audit trail with text export

**What changed:** Each task has an append-only `audit` list of `{at, type, actor, text}` (types: created, status, assignee, qa, retry; capped at 1000). The engine writes entries at status changes (review, testing, done by auto-merge), QA results, assignee changes and retries. `upsert('tasks')` ignores any `audit` sent by callers and, for plain UI saves, records status/assignee diffs as actor "You". The task drawer lists events newest first with an "Export as text" button (`auditText`).

**Where:** `src/engine.js` (`logAudit`, `auditEntries`, `auditText`, `normAudit`, `upsert`), `src/main.js` and `src/preload.js` (IPC for export), `src/renderer/app.js`, `app.html`.

**Tested:** `scripts/test-audit-trail.js`.

**Gotchas:**
- Engine code that changes a stored task in place must call `logAudit` itself; the diff in `upsert` only works when the saved object is a different object from the stored one (`prev !== obj`).
- New status transitions need their own `logAudit` call or they will be missing from the trail.
- BWI-37 added actor "PM" for auto-pulled tasks.

**Open questions:** Whether the 1000-entry cap silently dropping old entries is acceptable. Whether the "created" type is written anywhere; I did not confirm it.
