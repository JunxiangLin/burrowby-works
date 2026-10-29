# BWI-37: PM auto-pulls Backlog tickets when workers are idle

**What changed:** With `autoPull` on (default off), after each schedule pass the engine sends the highest-priority unblocked Backlog tickets to idle workers. At most one ticket per idle worker.
**Where:** `src/engine.js`: `autoPullBacklog`, `idleWorkers`, `isBlocked`, `specialtyScore`, `autoPull` in `factoryDoc` and `setFactory`, and a new `deps` field on tasks (task keys such as `P-3`). `sendTask` takes `autoPulled` and logs the audit actor 'PM'. UI: an `#autoPullBtn` toggle in `src/renderer/app.html` and `app.js` (`paintAutoPull`).
**Testing:** `scripts/test-pm-autopull.js` (99 lines).
**Gotchas:** Never uses PM or QA workers. Does nothing while any job is queued. Priority order is urgent, high, med, low, then board order. Projects with a ready repo only use coders. Other tickets prefer non-coders. A reentry guard `_pulling` is needed because `sendTask` triggers scheduling. The reason is appended to the task description. A `deps` entry that cannot be found does not block.
**Open questions:** Nothing in the UI edits `deps` yet (engine field only). The auto-pull toggle persists through `setFactory`, which I did not test through the real IPC path.
