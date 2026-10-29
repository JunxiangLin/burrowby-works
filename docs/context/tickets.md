# Ticket context entries

Merged PRs and commits are in `git log --grep=BWI-NN`. "Tests" names the script in `scripts/`; run with `npm run check` or `node scripts/<file>` (which scripts `npm test` includes: see package.json, unverified).

## BWI-11 Show app version in Settings
- Changed: Settings window displays the app version.
- Where: `src/main.js` (supplies version), `src/renderer/settings.html`, `settings.js`.
- Tested: no dedicated script. Found while working that `npm run check` failed in a worker sandbox (fixed in acc36f2: check clears GIT_CONFIG_* env for its temp repos).
- Gotchas: README says the scrubbed worker env guards against pushes, it is not a sandbox.
- Open: no automated test for the version label.

## BWI-12 QA Testing stage
- Changed: coder PR moves task to Testing and queues a QA worker. Pass -> Review (or auto-merge -> Done), fail -> In progress with QA notes. Merged with auto-merge (#7) into one pipeline.
- Where: `src/engine.js` (JOB_FIELDS qa/qaFor/merge, startQa, qaWillRun), `src/repos.js` (QA worktree helpers), `app.js`/`app.html` column and notes, README "QA stage and auto-merge".
- Tested: `scripts/check-code.js` (QA pass/fail/no-verdict/direct job, auto-merge cases).
- Gotchas: UI changes belong in `scripts/port-artifact.py` (step 13); editing generated `app.js`/`app.html` directly is lost on the next port run. `qaWillRun` must mirror `startQa`.
- Open: none known.

## BWI-17 PM auto-accept proposals to Backlog
- Changed: PM-created tickets go to the Backlog without owner approval (setting).
- Where: `src/engine.js`.
- Tested: `scripts/test-pm-autoaccept.js`; existing PM check in `check-code.js` runs with auto-accept off.
- Gotchas: tests must switch the setting off to exercise the manual path.
- Open: default value of the setting (unverified).

## BWI-19 Retry button and visible error
- Changed: failed job cards show the error, retry count and a Retry button.
- Where: `src/engine.js`, `src/renderer/app.js`, `pet.js`.
- Tested: `scripts/check-retry.js`.
- Gotchas: capped by BWI-28.
- Open: none known.

## BWI-20 Estimated cost per job
- Changed: estimated cost stored per finished job, shown on cards and project header.
- Where: `src/pricing.js`, `src/engine.js`, `app.js`/`app.html`.
- Tested: `scripts/check.js`, `scripts/pricing.test.js`.
- Gotchas: it is an estimate from a price table; prices go stale (unverified how updated).
- Open: who owns the price table.

## BWI-21 Job history view
- Changed: per-project history with worker/status filters and cost; retention of old jobs; CLI access.
- Where: `src/engine.js`, `src/cli.js`, `app.js`/`app.html`/`app.css`, README.
- Tested: `scripts/test-job-history.js` (500-job load test, retention, cost persistence).
- Gotchas: retention drops old jobs, so history is bounded (limit in engine.js).
- Open: retention limit tuning.

## BWI-22 Validate worker output format
- Changed: PM fenced JSON is validated before a job is done; one automatic fix attempt, then the task goes to Review labelled "needs review".
- Where: `src/engine.js` (onJobFinished, needsReview).
- Tested: `scripts/test-output-validation.js`.
- Gotchas: malformed output is parked in Review, never silently accepted; audit trail records it.
- Open: validation covers PM output only (unverified for others).

## BWI-23 CI smoke test for pipeline
- Changed: GitHub workflow runs the factory pipeline with a stub model.
- Where: `.github/workflows/smoke.yml`, `scripts/smoke-pipeline.js`, `package.json`.
- Tested: the smoke script itself.
- Gotchas: stub model, so it does not catch real model output problems.
- Open: none known.

## BWI-24 Blocked state with required reason
- Changed: tickets can be Blocked, a reason is required, board badge, logged as a change.
- Where: `src/engine.js` (engine-level enforcement, so UI cannot skip it), `app.js`/`app.html`/`app.css`.
- Tested: `scripts/test-blocked.js`.
- Gotchas: enforced in the engine, not just the UI.
- Open: none known.

## BWI-25 Acceptance-criteria QA checklist gates Done
- Changed: Done requires acceptance criteria to be checked; foreman `update_task` is gated too.
- Where: `src/engine.js`, `app.js`/`app.html`/`app.css`.
- Tested: `scripts/check.js` (foreman gate test).
- Gotchas: tasks without criteria behavior is unverified.
- Open: same.

## BWI-26 Owner daily digest
- Changed: pet speech bubble shows shipped, stuck, needs-you.
- Where: `src/digest.js`, `main.js`, `preload.js`, `pet.js`/`pet.css`.
- Tested: `scripts/check-digest.js`, `check-digest-extra.js`.
- Gotchas: digest builder is pure; keep it that way for tests.
- Open: none known.

## BWI-27 Per-ticket audit trail
- Changed: status, assignee, QA and retry events (time, actor) recorded per task; drawer lists newest first; export as text.
- Where: `src/engine.js` (logAudit), `main.js`, `preload.js`, `app.js`/`app.html`.
- Tested: `scripts/test-audit-trail.js`.
- Gotchas: the engine owns the trail; UI saves cannot rewrite it.
- Open: none known.

## BWI-28 Cap retries, keep failed-run logs
- Changed: worker retries per ticket are capped; failed-run logs are kept.
- Where: `src/engine.js`, `main.js`, `preload.js`, `app.js`.
- Tested: `scripts/check.js`, `check-code.js`.
- Gotchas: interacts with the BWI-19 retry button.
- Open: cap value (unverified).

## BWI-32 Concurrent jobs limit 3 -> 12
- Changed: engine accepts whole numbers 1-12; UI presets 4/6/8/12 plus typed input and rate-limit/worktree warning.
- Where: `src/engine.js` (setFactory, setConcurrency, foreman tool, load), `app.js`/`app.html`, README.
- Tested: `scripts/check.js`.
- Gotchas: lowering never kills running jobs; the scheduler only holds back new starts.
- Open: real rate-limit behavior at 12.

## BWI-33 Jobs never wrote to context
- Changed: finished jobs save a summary to the context library (setting `autoSummary`, default on).
- Where: `src/engine.js` saveJobSummary, called from onJobFinished.
- Tested: `scripts/test-job-summary.js`.
- Gotchas: root cause was that nothing in the completion path wrote contexts. Stable id `c_job_<id>` so repeats update. Content is passed through `redact`. A failed summary never breaks completion.
- Open: output is truncated to 6000 chars.

## BWI-34 Route QA jobs to any free QA worker
- Changed: QA verification is not tied to one worker.
- Where: `src/engine.js`.
- Tested: `scripts/test-qa-routing.js`.
- Gotchas: relates to BWI-12 qaFor.
- Open: none known.

## BWI-35 Merge conflicts when merging PRs into dev
- Changed: conflicts are handled in the auto-merge flow.
- Where: `src/engine.js`, `src/repos.js`, `scripts/check-code.js`.
- Tested: `scripts/check-code.js`.
- Gotchas: details of handling not verified here; read commit a11cd47.
- Open: same.

## BWI-37 PM auto-pulls Backlog tickets
- Changed: when workers are idle, the PM pulls Backlog tickets to the factory.
- Where: `src/engine.js`, `app.js`/`app.html` (setting).
- Tested: `scripts/test-pm-autopull.js`.
- Gotchas: interacts with BWI-14 auto-send of Todo and the concurrency limit (BWI-32).
- Open: default setting (unverified).
