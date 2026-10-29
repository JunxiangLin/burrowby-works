# BWI-17: Auto-accept PM proposals onto the Backlog

**What changed:** When a PM job finishes `done` with proposals, `onJobFinished` calls `acceptProposals(job.id)` if `autoAcceptPm !== false` (default on). `acceptProposals` skips tickets whose title (trimmed, lowercased) already exists in the project, and appends "Created by job #N." to the description. New tickets get status `backlog` and label `proposed`. Setting `autoAcceptPm` is part of `factoryDoc`/`setFactory`.

**Where:** `src/engine.js` (`onJobFinished`, `acceptProposals`, `factoryDoc`, `setFactory`, constructor load).

**Tested:** `scripts/test-pm-autoaccept.js` (new). `scripts/check-code.js` now turns auto-accept off for the existing PM check so it still tests the manual path. Run with `node scripts/test-pm-autoaccept.js`.

**Gotchas:**
- A PM job with no project is swallowed silently (try/catch) and left for manual accept.
- Dedupe is by exact title only. A reworded duplicate gets through.
- BWI-22 later made malformed PM output fail before this runs.

**Open questions:** No UI toggle for `autoAcceptPm` that I confirmed; it is only settable via `setFactory`.
