# BWI-23: CI smoke test for the factory pipeline with a stub model

**What changed:** GitHub Actions workflow runs the pipeline end to end against a stub model on every push.
**Where:** `.github/workflows/smoke.yml` (Node 22, `npm ci` with `ELECTRON_SKIP_BINARY_DOWNLOAD=1`, 2 minute timeout), `scripts/smoke-pipeline.js`, `package.json` script `smoke:pipeline`.
**Testing:** `npm run smoke:pipeline` locally (plain node, no Electron).
**Gotchas:** The existing `smoke` script still needs Electron and is not used in CI. The engine needs no Electron binary. The workflow triggers on `push` only, not on pull requests.
**Open questions:** Does the smoke test cover the QA and auto-merge stages? I did not check. Not confirmed on a real Actions run.
