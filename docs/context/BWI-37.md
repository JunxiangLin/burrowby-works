# BWI-37: PM auto-pulls Backlog tickets when workers are idle

**What changed:** New setting `autoPull` (default **off**, only `true` enables it; in `factoryDoc`/`setFactory`). At the end of every `schedule()`, `autoPullBacklog()` picks the highest-priority, unblocked Backlog tickets, at most one per idle worker, and calls `sendTask(id, {autoPulled: true})`. Idle workers = capability `code` or `text` (never PM or QA), not busy, with free concurrency room and no queued jobs. Blocked = any task key in `deps` that is not done (new `deps` field on tasks). Coding projects need a coder; other tickets prefer non-coders. Ties are broken by `specialtyScore`. A "Picked by PM auto-pull: ..." line is appended to the ticket description and the audit actor is "PM".

**Where:** `src/engine.js` (`autoPullBacklog`, `idleWorkers`, `isBlocked`, `specialtyScore`, `normTask`, `sendTask`), `src/renderer/app.html` and `app.js` (toggle, 13 lines).

**Tested:** `scripts/test-pm-autopull.js`.

**Gotchas:**
- The `_pulling` flag stops recursion, since `sendTask` calls back into scheduling.
- Each pull appends to the description, so repeated pulls of a ticket that returns to Backlog stack the notes.
- Unknown dep keys are ignored, so a typo does not block a ticket.
- Pulling is skipped while any job is queued.

**Open questions:** Whether `deps` should be editable in the UI. I did not check whether it is.
