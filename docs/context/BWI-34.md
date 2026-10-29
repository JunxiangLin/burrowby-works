# BWI-34: Route QA verification jobs to any free QA worker

**What changed:** `startQa` now creates the QA job with worker `any` instead of pinning to one QA worker. In the scheduler, jobs with `qaFor` only go to workers with capability `qa` (least busy idle one wins) and never get the "send to a coder" preference. Older QA jobs pinned to a busy QA worker are released to `any` when another QA worker is free. The Testing notice no longer names a worker.

**Where:** `src/engine.js` (`schedule`, `startQa`).

**Tested:** `scripts/test-qa-routing.js`.

**Gotchas:**
- If the factory has no idle QA worker the job waits; it never falls back to a non-QA worker.
- Pinned QA jobs are rewritten in the scheduler, so the job's `pref` changes after creation.

**Open questions:** What should happen if all QA workers are removed while QA jobs are queued; I did not test that.
