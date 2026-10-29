# BWI-26: Owner daily digest (shipped, stuck, needs you)
- Changed: a digest appears in the pet speech bubble.
- Where: `src/digest.js` (builder), `src/main.js`, `src/preload.js`, `src/renderer/pet.js` and `pet.css`. Commits 6516338, 424a48c.
- Tested: `scripts/check-digest.js`, `scripts/check-digest-extra.js`.
- Gotchas: the builder is a separate module so it can be tested without Electron.
- Open: scheduling/frequency details live in `src/main.js`; check there before changing.
