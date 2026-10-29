# Ticket context entries (BWI-43)

One entry per ticket, reconstructed from git history (commits, diffs, test scripts) on `dev`.
Each entry: what changed, where, how it was tested, gotchas, open questions.
Acceptance-criteria text of the original tickets was not available to me, so "open questions" are
my own reading of the code, not requirements. Run a script with `node scripts/<name>.js`; `npm test`
does not exist, `npm run check` runs `scripts/check.js`.

## BWI-11: App version in Settings window
- **Changed:** Settings window shows the app version. `src/main.js` (passes version), `src/renderer/settings.html`, `src/renderer/settings.js`.
- **Tested:** no dedicated script; visual only.
- **Gotchas:** tiny change (3 lines); nothing depends on it.
- **Open:** none.

## BWI-12: QA Testing stage between In progress and Review
- **Changed:** new `testing` task status. A finished coder job spawns a QA verification job (`qaFor` = coder job id) built from the ticket's acceptance criteria and the coder's summary. `src/engine.js` (largest change), `src/repos.js`, `src/renderer/app.html|js`, README.
- **Tested:** `scripts/check-code.js` extended (+100 lines).
- **Gotchas:** merged together with the auto-merge-worker-PRs work so QA and auto-merge are one pipeline. QA workers are named from `QA_NAMES`.
- **Open:** behaviour when no QA worker exists is worth confirming.

## BWI-17: Auto-accept PM proposals onto the Backlog
- **Changed:** `src/engine.js`. New `autoAcceptPm` factory setting (default on, persisted in `factoryDoc`/`setFactory`). When a `pm` job is done with proposals, `acceptProposals` runs automatically. It skips titles that already exist in the project (case-insensitive) and appends "Created by job #N." to the description.
- **Tested:** `scripts/test-pm-autoaccept.js`; `scripts/check-code.js` runs the old PM check with auto-accept off.
- **Gotchas:** a job with no project silently leaves proposals for manual accept (error swallowed on purpose). Dedupe is by title only.
- **Open:** no UI toggle for `autoAcceptPm` that I could find in this commit.

## BWI-19: Retry button, visible error and retry count
- **Changed:** `retryJob` creates a new job linked by `retryOf` with `retries` incremented, and now keeps `taskId`. New job fields in `JOB_FIELDS`. UI in `src/renderer/app.js` and `pet.js`.
- **Tested:** `scripts/check-retry.js`.
- **Gotchas:** retry is a new job, not a reset of the old one, so history shows both.
- **Open:** no cap on retries.

## BWI-22: Validate worker output format
- **Changed:** `validateTickets` in `src/engine.js` requires PM output to contain a fenced JSON block. One automatic fix retry (`formatRetried`); if still bad the job gets `needsReview` and its task is moved to Review with label "needs review" and an audit entry.
- **Tested:** `scripts/test-output-validation.js`.
- **Gotchas:** only checks the fenced-block presence/parse, not field contents.
- **Open:** whether other job kinds need validation.

## BWI-23: CI smoke test with stub model
- **Changed:** `.github/workflows/smoke.yml`, `scripts/smoke-pipeline.js`, `package.json` script `smoke:pipeline`.
- **Tested:** is itself the test; runs without a real model.
- **Gotchas:** `npm run smoke` (Electron UI) is separate and not run in CI.
- **Open:** none known.

## BWI-25: Acceptance-criteria checklist gates Done
- **Changed:** QA checklist built from acceptance criteria in `src/renderer/app.js`/`app.html`/`app.css`; Done transition blocked until checked. `src/engine.js` 1 line. Follow-up commit tests the foreman `update_task` gate in `scripts/check.js`.
- **Tested:** `scripts/check.js`.
- **Gotchas:** the gate is enforced in the UI and the foreman tool; confirm other engine paths (e.g. CLI in `src/cli.js`) are covered.
- **Open:** the CLI path is unverified.

## BWI-26: Owner daily digest
- **Changed:** `src/digest.js` builds shipped / stuck / needs-you summary; `src/main.js`, `src/preload.js`, `src/renderer/pet.js|css` show it in the pet speech bubble.
- **Tested:** `scripts/check-digest.js`, `scripts/check-digest-extra.js`.
- **Gotchas:** display is only in the pet bubble.
- **Open:** schedule/trigger timing should be checked in `main.js`.

## BWI-27: Per-ticket audit trail with text export
- **Changed:** `src/engine.js` (`logAudit`, status/field changes logged), `src/main.js` + `src/preload.js` export call, `src/renderer/app.js|html`.
- **Tested:** `scripts/test-audit-trail.js`.
- **Gotchas:** the BWI-22 path logs as actor "System".
- **Open:** audit retention/size limits not addressed.

## BWI-32: Jobs-at-once limit 3 -> 12
- **Changed:** `MAX_CONCURRENCY`/`validConc` in `src/engine.js` (load, `setConcurrency`, `setFactory`, foreman `set_jobs_at_once`). UI presets 4/6/8/12, typed input and rate-limit warning in `app.html|js`. README.
- **Tested:** `scripts/check.js`.
- **Gotchas:** lowering never kills running jobs; the scheduler only stops starting new ones. High values risk rate limits and many worktrees.

## BWI-33: Jobs write a summary to the context library
- **Changed:** `saveJobSummary` and `onJobFinished` in `src/engine.js`. One entry per job, id `c_job_<jobId>`, tags `job-summary`, project key and worker name; content passed through `redact`. `autoSummary` setting turns it off.
- **Tested:** `scripts/test-job-summary.js`.
- **Gotchas:** only for `done` jobs; failures in saving are swallowed; result truncated to 6000 chars.
- **Open:** failed jobs get no summary.

## BWI-34: Route QA jobs to any free QA worker
- **Changed:** `src/engine.js` scheduler. QA jobs are created with pref `any` and only go to `capability === 'qa'` workers; old pinned QA jobs are released when their worker is busy and another QA worker is free.
- **Tested:** `scripts/test-qa-routing.js`.
- **Gotchas:** with no QA worker the job stays queued.

## BWI-37: PM auto-pulls Backlog tickets when workers are idle
- **Changed:** `src/engine.js` (+64), `src/renderer/app.html|js` (setting).
- **Tested:** `scripts/test-pm-autopull.js`.
- **Gotchas:** interacts with concurrency (BWI-32) and QA routing (BWI-34).
- **Open:** I did not re-read the full diff for this entry; check the setting's default.

## BWI-43: this review
- **Changed:** this file only.
- **Tested:** docs only.
- **Gotchas:** I could not confirm which tickets were mine versus other workers', since every commit has the same author. I covered all BWI tickets in `dev` history.
