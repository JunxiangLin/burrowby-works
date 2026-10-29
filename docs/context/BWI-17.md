# BWI-17: Auto-accept PM proposals onto the Backlog

**What changed:** When a PM job finishes with proposals, they become Backlog tasks automatically. Setting `autoAcceptPm` (default on).
**Where:** `src/engine.js`: `onJobFinished` calls `acceptProposals(j.id)`. `acceptProposals` skips tickets whose title (case-insensitive) already exists in the project and adds "Created by job #N." to the description. `setFactory` and `factoryDoc` carry the flag.
**Testing:** `scripts/test-pm-autoaccept.js` (new). `scripts/check-code.js` now runs the existing PM check with auto-accept off.
**Gotchas:** Accepted tasks get the label `proposed`. A job with no project leaves its proposals for manual accept (the error is swallowed on purpose). Dedup is by title only. BWI-22 validates the PM output before this runs. BWI-37 auto-pull acts on these Backlog tasks.
**Open questions:** No UI toggle for `autoAcceptPm` that I know of (engine setting only). Not verified.
