---
type: context
scope: project
status: active
last_updated: 2026-09-21
last_reviewed: 2026-09-21
review_after: 2026-12-20
tags: []
---

# Context

`src/inventory.js` owns bounded source enumeration and metadata exports. `src/disk-tools.js` owns browser folder access, comparison, and streaming downloads. `scripts/build.cjs` creates the offline launcher. `scripts/package.py` builds a deterministic release archive from an explicit allowlist. Tests use synthetic data only.

The OneDrive website API is undocumented and can change. The browser session and granted directory handle remain in the current tab. Reloading clears them. Account exports are user-private runtime artifacts.


`src/metadata-tools.js` exports a fresh sanitized date-repair manifest.
`native/repair-dates.py` is the optional offline Python 3.11+ helper; it verifies
file contents and sets timestamps through native handles, never network calls
or file-content writes. Native tests live in `test/test_repair_dates.py`.

`src/archive-tools.js` exports bounded one-file ZIPs for browser-restricted types.
`native/restore-zip.py` validates and restores missing originals offline, sharing
native path/date primitives with repair-dates.py; it optionally cleans up only
verified input ZIPs. See docs/zip-recovery.md.
