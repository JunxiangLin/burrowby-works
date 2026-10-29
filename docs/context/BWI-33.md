# BWI-33: Jobs never wrote to the context library

**Root cause:** Nothing in `onJobFinished` wrote to `this.contexts`. Jobs only read context into prompts, so `search_context` could never find a job result.

**What changed:** `saveJobSummary(j)` runs when a job finishes with status `done` (if `autoSummary !== false`, default on). It upserts one context entry with stable id `c_job_<jobId>` (a repeat updates, never duplicates). Title "Job #N summary: <first line>", kind `note`, tags `job-summary`, `job-N`, project key, worker name. Content has the request (1000 chars), branch/PR, and the result (6000 chars), passed through `redact`. Errors in the save are swallowed so they cannot break job completion.

**Where:** `src/engine.js` (`saveJobSummary`, `onJobFinished`, `factoryDoc`, `setFactory`, load).

**Tested:** `scripts/test-job-summary.js`.

**Gotchas:**
- Only `done` jobs are saved, not failed or cancelled ones.
- QA jobs and PM jobs are saved too, which adds noise to search.
- `autoSummary` has no UI toggle that I confirmed.

**Open questions:** Whether the library needs a cleanup or cap for summaries, since one entry is created per job.
