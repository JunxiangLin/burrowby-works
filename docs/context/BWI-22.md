# BWI-22: Validate PM output format before marking done

**What changed:** PM jobs must end with a fenced JSON block of tickets. If the output is invalid, the worker gets one auto-fix prompt. If it is still invalid, the job fails with `error = 'needs_review'` and `needsReview = true`, and the task is parked in Review with the label `needs review`.
**Where:** `src/engine.js`: `validateTickets` (exported), the PM branch in `runJob`, `onJobFinished` needsReview branch, and `JOB_FIELDS` adds `needsReview` and `formatRetried`.
**Testing:** `scripts/test-output-validation.js` (59 lines).
**Gotchas:** The fix attempt adds to `outTok` and replaces `j.output`. A cancelled error during the fix is re-thrown. Other fix errors become a validation failure. The needs-review path takes priority over the QA branch in `onJobFinished`. Only the format is validated, not ticket quality.
**Open questions:** Should other worker kinds get validation? Should `needs review` clear when the owner moves the card?
