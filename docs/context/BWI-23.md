# BWI-23: CI smoke test for the factory pipeline (stub model)

**What changed:** New `npm run smoke:pipeline` runs `scripts/smoke-pipeline.js`, which drives the engine with a stub model (no real Claude calls). A GitHub Actions workflow `.github/workflows/smoke.yml` (name `pipeline-smoke`) runs it on every push: Node 22, `npm ci` with `ELECTRON_SKIP_BINARY_DOWNLOAD=1`, 2-minute timeout.

**Where:** `scripts/smoke-pipeline.js`, `.github/workflows/smoke.yml`, `package.json`.

**Tested:** The script is the test. I did not see a CI run result from here.

**Gotchas:**
- The engine needs no Electron binary; do not add `require('electron')` to anything the smoke test loads or CI breaks.
- It is separate from `npm run smoke`, which uses Electron (`scripts/smoke.js`).
- Triggers on every push, not only PRs.

**Open questions:** Which pipeline stages it covers beyond job -> done. Read the script before relying on it for QA or merge paths.
