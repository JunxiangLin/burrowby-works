# BWI-19: Retry button, visible error and retry count on failed job cards

**What changed:** `retryJob` now creates a new job that keeps `taskId` and sets `retryOf` (original job id) and `retries` (previous count + 1). Failed job cards in the pet's Jobs tab show the error (first 300 chars, "Full error" link), a Retry button, and "retry N" in the meta line.

**Where:** `src/engine.js` (`retryJob`, `JOB_FIELDS` gains `retryOf`, `retries`); `src/renderer/pet.js` (`renderJobs`, click handler); `src/renderer/app.js` (small change; I did not re-check what).

**Tested:** `scripts/check-retry.js` covers the engine side. The card rendering has no automated test; it was not checked in a running app.

**Gotchas:**
- Retry creates a new job, it does not revive the old one, so history keeps both.
- The job-list signature in `renderJobs` includes `retries`; without it the card would not repaint.
- BWI-27 added an audit entry on retry for the linked task.

**Open questions:** No cap on retries. A permanently failing job can be retried forever.
