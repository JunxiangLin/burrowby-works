# BWI-25: Acceptance-criteria QA checklist gates Done

**What changed:** The task drawer builds a QA checklist from the "Acceptance:" section of the description. Each criterion is Pass or Fail with a note. Done is blocked until every criterion passes, unless the owner override is ticked. The same gate applies to drag-and-drop and to the Foreman `update_task` tool.
**Where:** `src/renderer/app.js` (`parseCriteria`, `qaItems`, `canFinish`, `paintQa`, `saveQa`, the drop handler, `saveTaskForm`), `src/renderer/app.css`, `app.html` (`#tdQa`), `src/engine.js` (`update_task` throws if the description has acceptance criteria and `task.acceptance` does not pass or override). Test commit 80c14b0 extends `scripts/check.js`.
**Testing:** `scripts/check.js` covers the Foreman gate. The UI checklist was not run in a window.
**Gotchas:** The engine only checks that the description matches `acceptance` and that `t.acceptance` exists. The UI recomputes items from the text. Editing criteria text resets that item's result because items match by text. Criteria cap is 20. Stored as `t.acceptance = { items, override, checkedAt, overrideAt }`.
**Open questions:** The engine does not reparse criteria itself, so it trusts what the UI stored. Should the override be audited (BWI-27 audit trail)?
