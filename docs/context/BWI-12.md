# BWI-12: QA Testing stage between In progress and Review

**What changed (from the commit message and diff stats; I did not re-read the full 180-line engine diff):** Coder PRs move the task to `testing` and queue a QA worker automatically. Pass -> Review. Fail -> In progress for the original coder, with QA notes on the task (`task.qa`, last 8). Adds the `qa` worker capability, QA worktree helpers in `repos.js`, a Testing column, README docs. The branch was later merged with the auto-merge work so QA and auto-merge are one pipeline (merge to dev when checks pass sets Done).

**Where:** `src/engine.js` (`startQa`, `onQaFinished`, `parseQa`), `src/repos.js`, `src/renderer/app.js`, `app.html`, `README.md`.

**Tested:** `scripts/check-code.js` (about 100 lines added).

**Gotchas:**
- If QA cannot finish (error or stopped), the task goes to Review for a person.
- If a person moves the task out of Testing meanwhile, QA results do not move it back.
- If no QA worker exists, one is hired automatically (Mochi if free; see `QA_NAMES`).
- Later tickets that touch this flow: BWI-25, BWI-27, BWI-34.

**Open questions:** I am least sure of this entry. Check the code before relying on details.
