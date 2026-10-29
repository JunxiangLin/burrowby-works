# BWI-19: Retry button and visible error on failed jobs
- Changed: failed job cards show the error and retry count and have a Retry button. Jobs track `retryOf` / `retries`.
- Where: `src/engine.js` (retry logic, small), `src/renderer/app.js` (job card), `src/renderer/pet.js` (pet notice). Commits 4c9c4f3, 88ec554.
- Tested: `scripts/check-retry.js`.
- Gotchas: retry creates a linked job rather than reusing the failed one.
- Open: no retry cap that I verified.
