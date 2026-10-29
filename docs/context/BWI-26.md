# BWI-26: Owner daily digest in the pet speech bubble

**What changed:** A digest of Shipped, Stuck and Needs you appears in the pet's speech bubble. It is sent at most once per 24h, plus a "Show daily digest" pet menu item.
**Where:** `src/digest.js` (pure `buildDigest`), `src/main.js` (`makeDigest`, `works:digest` IPC, hourly timer, `lastDigestAt` in config), `src/preload.js`, `src/renderer/pet.js` and `pet.css`.
**Testing:** `scripts/check-digest.js` and `scripts/check-digest-extra.js` (424a48c).
**Gotchas:** Window is the last 24h. Stuck means failed jobs in the window, active jobs older than 24h, or blocked merges. Needs you means tasks in `review`. Max 3 lines per section, with a `more` count. Empty sections are hidden. If the whole digest is empty the automatic send is skipped, but `lastDigestAt` is still saved. The first check runs 15s after startup. The manual menu item always sends.
**Open questions:** Should the digest go out at a fixed local time rather than a rolling 24h? Does the pet.js rendering handle long lines? Not checked in a window.
