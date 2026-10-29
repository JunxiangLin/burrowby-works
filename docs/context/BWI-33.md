# BWI-33: Jobs write a summary to the context library
- Changed: when a job finishes `done`, `saveJobSummary` upserts a context entry (id `c_job_<jobId>`, kind note, tags job-summary, job-N, project key, worker name). Content is redacted and capped (request 1000 chars, result 6000).
- Where: `src/engine.js` (`saveJobSummary`, `onJobFinished`). Commit 35b98e3.
- Tested: `scripts/test-job-summary.js`.
- Gotchas: stable id means repeat calls update, not duplicate. Disabled when `autoSummary === false`. Failures are swallowed so they never break completion.
- Open: no pruning of old summaries.
