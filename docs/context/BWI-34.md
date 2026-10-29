# BWI-34: Route QA verification jobs to any free QA worker

**What changed:** QA jobs are no longer pinned to the worker chosen when the coder finished. They use `pref: 'any'` and go only to QA-capable workers, with the least-busy idle one winning.
**Where:** `src/engine.js`: `schedule()` (QA filter, plus a release of older pinned QA jobs when another QA worker is free) and `startQa` (creates the job with `'any'`, new Testing notice).
**Testing:** `scripts/test-qa-routing.js` (40 lines).
**Gotchas:** The "coder preferred for repo tasks" rule is skipped for QA jobs. Queued QA jobs already pinned to a busy QA worker are re-pointed to `any` on the next schedule pass. If no QA worker exists, the job stays queued. The notice text no longer names a worker.
**Open questions:** Nothing alerts the owner when no QA worker exists.
