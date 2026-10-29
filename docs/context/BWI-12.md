# BWI-12: QA Testing stage between In progress and Review
- Changed: new `testing` task status. When a coder job finishes with a PR, a QA verification job is created; pass moves the task to Review, fail sends it back to In progress. Merged with auto-merge so QA + merge are one pipeline.
- Where: `src/engine.js` (QA job creation, `qaFor` job field, task status handling), `src/repos.js`, `src/renderer/app.js` / `app.html` (board column), README. Commits 467f3f2, e0e8b86.
- Tested: `scripts/check-code.js` extended (+~100 lines).
- Gotchas: QA job text is built from the task description plus the coder's summary (truncated to 3000 chars). Needs a worker with capability `qa`.
- Open: see BWI-34 for routing; behavior with no QA worker is not covered by a test I can confirm.
