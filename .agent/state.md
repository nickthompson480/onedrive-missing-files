---
type: state
scope: project
status: active
last_updated: 2026-09-28
last_reviewed: 2026-09-28
review_after: 2026-12-20
tags: []
---

# Project State

- Goal: Maintain a portable OneDrive Personal inventory and missing-file copier.
- Current work: v1.6.1 fixes large-file transfers by using a five-minute idle
  timeout, defaults to one download at a time, and offers an explicit bounded
  100 GiB / 12-hour recovery run. v1.6.0 remains the current published release.
- Validation: 64 local JavaScript tests pass, including progressing transfers
  beyond the idle interval, stalled streams, cancellation and metadata identity.
  Chromium synthetic native import and three-file recovery pass at concurrency
  one with the large budget selected. Python: 18 pass, two Windows-only skips.
- Live Windows: the v1.6 native helper completed under an approved process-only
  policy; validated import and three-file separate recovery passed. The parent
  execution policy remains Restricted. A later batch was stopped for the update.
  The user reports prior 429 responses with three parallel downloads; use one.
- Next action: pass hosted checks, publish v1.6.1, verify its downloaded archive
  and restart attended recovery at concurrency one. Inspect cancelled output
  placeholders before resuming; preserve all existing files.
- Boundaries: source GET-only; preserve existing local file contents. Metadata
  restoration previews by default and verifies hashes. Native ZIP cleanup is
  limited to explicit input archives after verified restoration. No account data,
  inventories, credentials, or signed URLs belong in Git.
- Unresolved: complete live large-file and full recovery acceptance. Junctions
  are references, not separate backup copies; native size comparison does not
  verify content or hydration. Operational evidence belongs to the client project.
