# Juniper: context entries for past tickets

One entry per ticket, written from the git history (`git log --grep=BWI`). Git does not record which worker
authored a commit, so this covers every BWI ticket with commits in the repo. Trim any that were not Juniper's.
"Tested" names the script added or changed. Run `npm run check` for the main suite; each `scripts/test-*.js` runs with `node`.
Items marked **Open** were not verified from the code and need a check by whoever picks the ticket up.

## BWI-11 Show app version in Settings
- **Changed:** Settings window shows the app version. Files: `src/main.js`, `src/renderer/settings.html`, `src/renderer/settings.js`.
- **Tested:** no script added (manual check in Settings).
- **Gotcha:** version comes from `package.json` (0.1.0).
- **Open:** no automated test.

## BWI-12 QA Testing stage on the board
- **Changed:** new Testing column between In progress and Review; QA and auto-merge merged into one pipeline. `src/engine.js`, `src/repos.js`, `src/renderer/app.{html,js}`, README.
- **Tested:** `scripts/check-code.js`.
- **Gotcha:** the dev merge (e0e8b86) joined QA and auto-merge, so changes to one affect the other. Also see the sandbox fix commit acc36f2 for `check-code.js`.
- **Open:** none known.

## BWI-13 save_context write path
- **Changed:** foreman/workers can save notes, decisions and job outputs to the context library (e5eb46f).
- **Tested:** **Open**, no dedicated script; covered indirectly by `scripts/check.js`.
- **Gotcha:** the context library lives in `works.json` under `%APPDATA%`, not in the repo.

## BWI-14 Auto-send Todo tasks to the factory
- **Changed:** global and per-project setting, default off (49639c3).
- **Tested:** **Open**, no dedicated script.
- **Gotcha:** default is off, so it is easy to think it is broken.

## BWI-17 PM auto-accept proposals
- **Changed:** PM proposals go straight to Backlog when auto-accept is on. `src/engine.js`.
- **Tested:** `scripts/test-pm-autoaccept.js`; `scripts/check-code.js` runs the existing PM check with auto-accept off.
- **Gotcha:** the old PM check assumes auto-accept off.

## BWI-18 Orphaned jobs and job timeout
- **Changed:** jobs left running when the app closed are recovered on launch; jobs time out (b3566e2).
- **Tested:** **Open**, no dedicated script.
- **Open:** the timeout value and where it is set were not re-checked.

## BWI-19 Retry button and visible error
- **Changed:** failed job cards show the error and retry count, plus a Retry button. `src/engine.js`, `src/renderer/app.js`, `src/renderer/pet.js`.
- **Tested:** `scripts/check-retry.js`.
- **Gotcha:** BWI-28 later capped retries, so the two interact.

## BWI-20 Estimated cost per job
- **Changed:** cost stored on each finished job, shown on cards and the project header.
- **Tested:** pricing unit tests (a5fed69), in `scripts/check.js`.
- **Open:** prices are estimates; update them when model pricing changes.

## BWI-21 Job history view
- **Changed:** per-project history with worker and status filters and cost; retention and cost persistence.
- **Tested:** 500-job load test.
- **Gotcha:** README says only the last 300 jobs are kept in `works.json`; check the retention number against that.

## BWI-22 Validate PM output format
- **Changed:** PM fenced JSON is validated before a job is marked done. One auto-fix attempt, then the card goes to Review with a `needs review` label. `src/engine.js` (`onJobFinished`).
- **Tested:** `scripts/test-output-validation.js`.

## BWI-23 CI pipeline smoke test
- **Changed:** stub-model pipeline smoke test and GitHub workflow. `.github/workflows/smoke.yml`, `scripts/smoke-pipeline.js`, `package.json` (`npm run smoke:pipeline`).
- **Tested:** it is the test; runs in CI.
- **Gotcha:** uses a stub model, so it never hits the real API.

## BWI-24 Blocked state with reason
- **Changed:** blocked status needs a reason; board badge; change log; also logged at engine level (eceb8f2).
- **Tested:** **Open**, no dedicated script.

## BWI-25 Acceptance-criteria QA checklist gates Done
- **Changed:** checklist from acceptance criteria must pass before a ticket moves to Done. `src/engine.js`, `src/renderer/app.{css,html,js}`.
- **Tested:** foreman `update_task` gate test in `scripts/check.js`.
- **Gotcha:** the foreman tool path is gated too, not just the UI.

## BWI-26 Owner daily digest
- **Changed:** shipped, stuck and needs-you digest in the pet speech bubble. `src/digest.js`, `src/main.js`, `src/preload.js`, `src/renderer/pet.{css,js}`.
- **Tested:** `scripts/check-digest.js`, `scripts/check-digest-extra.js`.

## BWI-27 Per-ticket audit trail
- **Changed:** audit trail view with text export. `src/engine.js` (`logAudit`), `src/main.js`, `src/preload.js`, `src/renderer/app.{html,js}`.
- **Tested:** `scripts/test-audit-trail.js`.
- **Gotcha:** new status changes should call `logAudit` or they will be missing from the trail.

## BWI-28 Retry cap and failed-run logs
- **Changed:** per-ticket retry cap; failed-run logs kept (9a9fe26).
- **Tested:** **Open**; see `scripts/check-retry.js`.

## BWI-32 Jobs-at-once limit 3 to 12
- **Changed:** limit raised. `src/engine.js`, `src/renderer/app.{html,js}`, README, `scripts/check.js`.
- **Gotcha:** README and UI text must match the engine value.

## BWI-33 Job summary saved to context
- **Changed:** `saveJobSummary` in `src/engine.js` writes one context entry per finished job (`c_job_<id>`), redacted, tagged `job-summary`. Skipped when `autoSummary === false`.
- **Tested:** `scripts/test-job-summary.js`.
- **Gotcha:** failures are swallowed on purpose so job completion never breaks. Only `done` jobs get a summary.

## BWI-34 QA routing
- **Changed:** QA verification jobs go to any free QA worker. `src/engine.js`.
- **Tested:** `scripts/test-qa-routing.js`.

## BWI-35 Merge conflicts when merging PRs into dev
- **Changed:** conflict handling in the PR merge step (a11cd47).
- **Tested:** **Open**, no dedicated script.

## BWI-37 PM auto-pulls Backlog tickets
- **Changed:** PM moves Backlog tickets to the factory when workers are idle. `src/engine.js`, `src/renderer/app.{html,js}`.
- **Tested:** `scripts/test-pm-autopull.js`.
- **Gotcha:** interacts with BWI-14 (auto-send Todo) and the jobs-at-once limit.
