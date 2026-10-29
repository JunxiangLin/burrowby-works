# BWI-26: Owner daily digest in the pet speech bubble

**What changed:** `buildDigest` (pure function in `src/digest.js`) returns sections Shipped, Stuck, Needs you for the last 24h. Stuck = failed jobs, queued/running jobs older than 24h, and blocked merges. Needs you = tasks in Review. Max 3 lines per section plus a "more" count; empty sections are hidden. `main.js` sends it to the pet overlay once per 24h (checked on startup after 15s and then hourly, stored as `lastDigestAt` in config) and via a "Show daily digest" menu item. IPC: `works:digest`.

**Where:** `src/digest.js`, `src/main.js`, `src/preload.js`, `src/renderer/pet.js`, `pet.css`.

**Tested:** `scripts/check-digest.js` and `scripts/check-digest-extra.js` (builder only). The scheduling and the speech-bubble rendering are not tested.

**Gotchas:**
- `lastDigestAt` is saved before the digest is built, so an empty digest still uses up that day's slot.
- Timestamps use `finishedAt`; jobs missing it never count as shipped or failed.

**Open questions:** Whether showing nothing on an empty day is the right behaviour.
