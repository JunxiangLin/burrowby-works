# BWI-11: Show app version in Settings window

**What changed:** The Settings window shows the app version. Three small edits: `src/main.js` (one line, passes the version), `src/renderer/settings.html` (one line), `src/renderer/settings.js` (one line).

**Tested:** No test was added. I did not verify it in a running app.

**Gotchas:** The version comes from `package.json` (currently 0.1.0), so it only changes when that file is edited.

**Open questions:** None known. This is the entry I know least about; I only have the diff stats.
