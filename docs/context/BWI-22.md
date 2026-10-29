# BWI-22: Validate PM output format before marking done

**What changed:** After a PM job finishes, `validateTickets(output)` requires a fenced JSON block that parses into a non-empty list of tickets with titles. If invalid, the job gets one automatic fix attempt (`formatRetried = true`, re-prompts with the bad reply and the error). If still invalid, the job becomes `failed` with `error: 'needs_review'`, `needsReview: true`, and no proposals. `onJobFinished` then moves the linked task to Review with the label `needs review` and emits a notice.

**Where:** `src/engine.js`: `validateTickets` (exported), the PM branch in `runJob`, `onJobFinished`, `JOB_FIELDS` (+`needsReview`, `formatRetried`).

**Tested:** `scripts/test-output-validation.js`.

**Gotchas:**
- The fix attempt adds to `outTok` and streams over the same output, so the user sees the text restart.
- If the fix call fails (not cancelled), the job goes to needs review with "fix attempt failed".
- Auto-accept (BWI-17) never sees bad output because proposals are empty.

**Open questions:** Only the format is checked, not ticket quality. The fix prompt truncates the old reply at 20000 chars.
