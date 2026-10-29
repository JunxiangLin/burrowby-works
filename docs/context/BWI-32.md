# BWI-32: Raise the jobs-at-once limit from 3 to 12

**What changed:** Concurrency accepts whole numbers 1-12 (was 1-3).
**Where:** `src/engine.js` (`setFactory`, `setConcurrency`, foreman tool, load), `src/renderer/app.html` and `app.js` (presets 4/6/8/12, a typed number input and a warning about rate limits and worktrees), `README.md`, `scripts/check.js`.
**Testing:** New assertions in `scripts/check.js`. Run `npm run check`.
**Gotchas:** Lowering never kills running jobs. The scheduler only holds back new starts. `MAX_WORKERS` is also 12. Raising concurrency does nothing without enough workers. Rate limits and many worktrees are the real risk at high values.
**Open questions:** Real-world rate-limit behaviour at 12 is untested.
