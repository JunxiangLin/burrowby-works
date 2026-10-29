# BWI-12: QA Testing stage between In progress and Review

**What changed:** New `testing` board column and a `qa` worker capability. When a coder's PR is opened, the task moves to Testing and a QA job is queued automatically. Pass moves the task to Review. Fail moves it back to In progress for the original coder, with QA notes on the task.
**Where:** `src/engine.js` (`startQa`, `onQaFinished`, `parseQa`, `QA_NAMES`, `CAPABILITIES`), `src/repos.js` (QA worktree helpers), `src/renderer/app.html` and `app.js` (column and notes), README (pipeline docs). Merged with auto-merge work in e0e8b86 so QA and auto-merge are one pipeline.
**Testing:** `scripts/check-code.js` extended (about 100 lines) using real git. Run `npm run check`.
**Gotchas:** `onJobFinished` decides the transition: coder code jobs with a branch go to QA, all other jobs go straight to Review. QA failure feeds notes into the next coder prompt through `sendTask`. BWI-34 later changed QA routing.
**Open questions:** None known. Is there a retry cap on QA fail loops? Not checked.
