# BWI-22: Validate worker output format before marking done
- Changed: PM jobs' fenced JSON output is validated before the job is marked done. One automatic fix attempt; if still invalid the job goes to needs-review.
- Where: `src/engine.js` (~50 lines). Commit 2d4d78e.
- Tested: `scripts/test-output-validation.js`.
- Gotchas: only PM output is validated; other worker types are unchanged.
- Open: the auto-fix is limited to exactly one retry by design.
