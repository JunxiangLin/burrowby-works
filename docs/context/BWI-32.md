# BWI-32: Raise the jobs-at-once limit from 3 to 12

**What changed:** The engine accepts a whole-number concurrency from 1 to 12 in `setFactory`, `setConcurrency`, the foreman tool and on load. The Settings UI has presets 4/6/8/12, a typed number input, and a warning about rate limits and worktrees. Lowering the limit never kills running jobs; it only holds back new starts. README updated.

**Where:** `src/engine.js`, `src/renderer/app.html`, `src/renderer/app.js`, `README.md`, `scripts/check.js`.

**Tested:** `scripts/check.js` (5 new lines for the range). The UI was not tested.

**Gotchas:**
- Old saved data with values 1-3 still loads. A non-integer or out-of-range value falls back to the default (2).
- `scripts/check-code.js` still asserts the foreman message "Jobs at once: 3"; that is just an input in that test, not a limit.
- Many parallel coders means many git worktrees.

**Open questions:** Whether 12 was chosen for a real reason or just matches `MAX_WORKERS`.
