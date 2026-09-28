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
- Current work: v1.6.2 adds bounded transient retries and verified same-session
  byte-range resume. v1.6.2 is published and checksum-verified on Windows.
  v1.6.1 remains the active run; its first large
  video completed successfully at concurrency one with Large recovery selected.
- Validation: v1.6.2 has 78 passing JavaScript tests. Synthetic Chromium recovery
  resumed three interrupted files with exact byte counts and zero issues. All four
  v1.6.2 hosted checks passed, including native Windows PowerShell 5.1.
- Live Windows: the v1.6 native helper completed under an approved process-only
  policy; validated import and three-file separate recovery passed. The parent
  execution policy remains Restricted. A later batch was stopped for the update.
  The user reports prior 429 responses with three parallel downloads; use one.
- Next action: let the healthy v1.6.1 batch finish, save its report and use the
  downloaded v1.6.2 package for subsequent recovery. Operational progress and
  outstanding groups belong to the client workstream. Live resume remains untested.
- Boundaries: source GET-only; preserve existing local file contents. Metadata
  restoration previews by default and verifies hashes. Native ZIP cleanup is
  limited to explicit input archives after verified restoration. No account data,
  inventories, credentials, or signed URLs belong in Git.
- Unresolved: live range/CORS acceptance and full recovery completion. Junctions
  are references, not separate backup copies; native size comparison does not
  verify content or hydration. Operational evidence belongs to the client project.
