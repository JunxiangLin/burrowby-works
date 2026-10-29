# BWI-23: CI smoke test for the factory pipeline with a stub model
- Changed: CI workflow runs a pipeline smoke test using a stub model instead of a real one.
- Where: `.github/workflows/smoke.yml`, `scripts/smoke-pipeline.js`, `package.json` (script entry). Commit b1822d1.
- Tested: the smoke script itself; run via the npm script added in package.json.
- Gotchas: do not confuse with the older `scripts/smoke.js`.
- Open: whether CI has been green on GitHub is not recorded here.
