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
