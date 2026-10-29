# BWI-25: Require acceptance-criteria check before Done
- Changed: a QA checklist built from the task's acceptance criteria gates the move to Done in the UI; foreman `update_task` has a matching gate.
- Where: `src/renderer/app.js` (+~54), `app.css`, `app.html`, `src/engine.js` (1 line). Commits 264cd1e, 80c14b0.
- Tested: `scripts/check.js` has a foreman update_task gate test.
- Gotchas: the gate is mostly renderer-side; engine enforcement is via the foreman tool path.
- Open: whether other direct engine paths can bypass the checklist.
