# BWI-19: Retry button and visible error on failed job cards

**What changed:** Failed job cards show the error (first 300 chars, with a Full error link), a Retry button and a retry count. `retryJob` creates a new job with the same inputs, plus `taskId`, `retryOf` and `retries + 1`.
**Where:** `src/engine.js` (`retryJob`, `JOB_FIELDS` adds `retryOf` and `retries`), `src/renderer/pet.js` (job list), `src/renderer/app.js` (job detail: "Retry" label for failed jobs, `errorDetail` block, "retry N" in subtitle, `JOB_FIELDS`).
**Testing:** `scripts/check-retry.js` (engine check). The UI was not run in a real window.
**Gotchas:** A retry is a new job, so the old failed job stays in history. The pet.js render signature includes `retries` so cards repaint. The Retry button disables itself after a click.
**Open questions:** No cap on retries. Nothing yet unlinks a task's old failed job from `t.jobs`.
