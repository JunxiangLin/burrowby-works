# BWI-33: Jobs never wrote to the context library

**What changed:** Finished jobs now save a summary entry to the context library. Setting `autoSummary` (default on).
**Root cause:** Nothing in `onJobFinished` wrote to `this.contexts`. Entries only came from the UI and the sample project, so `search_context` never saw job results.
**Where:** `src/engine.js`: `saveJobSummary(j)` and the `onJobFinished` hook. The entry id is `c_job_<jobId>`, kind `note`, tags `job-summary`, `job-N`, project key and worker name. Content is redacted, with the request capped at 1000 chars and the result at 6000.
**Testing:** `scripts/test-job-summary.js`.
**Gotchas:** Only `done` jobs are summarised. The stable id means re-saving updates the same entry (upsert). A summary failure is swallowed so it cannot break job completion. Summaries are per job, not per ticket, so a ticket with several jobs has several entries.
**Open questions:** Entries could pile up. Is there any pruning? Should failed jobs be summarised?
