# BWI-17: PM workers create tickets automatically
- Changed: PM proposals are auto-accepted onto the Backlog. Toggle is `autoAcceptPm` (default on; only `false` disables it).
- Where: `src/engine.js` (applyData / setFactory read `autoAcceptPm`). Commits 6265af2, 310f4e6.
- Tested: `scripts/test-pm-autoaccept.js`; `scripts/check-code.js` runs the existing PM check with auto-accept off.
- Gotchas: older PM tests assume manual accept, so they must set auto-accept off.
- Open: no UI covered in this ticket beyond the setting.
