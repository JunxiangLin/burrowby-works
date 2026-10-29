# BWI-32: Raise the jobs-at-once limit from 3 to 12
- Changed: concurrency accepts whole numbers 1-12 (`MAX_CONCURRENCY`, `validConc` in `src/engine.js`) in applyData, setConcurrency, setFactory and the foreman `set_jobs_at_once` tool. UI has presets 4/6/8/12, a number input, and a warning at 6+.
- Where: `src/engine.js`, `src/renderer/app.js` / `app.html`, README, `scripts/check.js`. Commit 3ffedd0.
- Tested: new assertions in `scripts/check.js`.
- Gotchas: lowering never kills running jobs; the scheduler just holds back new starts. Default stays 2.
- Open: real rate-limit and worktree load at 12 is untested.
