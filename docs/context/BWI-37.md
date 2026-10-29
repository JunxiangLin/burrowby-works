# BWI-37: PM auto-pulls Backlog tickets when workers are idle
- Changed: the PM pulls Backlog tickets into the factory when workers are idle.
- Where: `src/engine.js` (~64 lines), `src/renderer/app.js` / `app.html` (setting/toggle). Commit bcba4ab.
- Tested: `scripts/test-pm-autopull.js`.
- Gotchas: interacts with concurrency (BWI-32) and QA routing (BWI-34); check idle logic there first.
- Open: exact trigger conditions should be read from the code before extending.
