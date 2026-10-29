# BWI-25: Acceptance-criteria QA checklist gates Done

**What changed:** Criteria are parsed from an "Acceptance:" part of the task description (`parseCriteria` in the renderer: same line split by `;`, or a following bullet/numbered list; max 20). The task drawer shows a Pass/Fail row with a note per criterion. Done is disabled until all pass, unless "Owner override" is checked. Dragging a card to Done is blocked the same way. Results are stored in `task.acceptance` ({items, override, checkedAt}).

**Where:** `src/renderer/app.js` (`parseCriteria`, `qaItems`, `canFinish`, `paintQa`, `saveQa`, `saveTaskForm`, board drop handler), `app.html`, `app.css`, one line in `src/engine.js`. A second commit added a foreman `update_task` gate test in `scripts/check.js`.

**Tested:** Only the foreman gate is covered, in `scripts/check.js`. The renderer gate (`canFinish`, drag block) has no automated test.

**Gotchas:**
- The gate is enforced in the UI and for the foreman. Engine auto-merge sets `done` directly and bypasses it by design (see BWI-12 flow).
- Edit a criterion's text and its earlier result is lost, because items are matched by exact text.
- A task with no parsed criteria is never gated.

**Open questions:** Whether the engine should enforce the gate for all writers. I did not check every place that sets `done`.
