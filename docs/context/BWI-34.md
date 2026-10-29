# BWI-34: Route QA verification jobs to any free QA worker
- Changed: QA jobs are created with pref `any` instead of pinned to one worker. The scheduler only gives `qaFor` jobs to workers with capability `qa`, picking the least busy. Older pinned QA jobs are released if their worker is busy and another QA worker is free.
- Where: `src/engine.js` scheduler (~line 326) and QA job creation (~line 443). Commit 2b0505e.
- Tested: `scripts/test-qa-routing.js`.
- Gotchas: QA jobs skip the "coder first" preference for repo projects. Notice text no longer names a worker.
- Open: with no QA worker, the job stays queued.
