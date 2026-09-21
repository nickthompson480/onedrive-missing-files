---
type: state
scope: project
status: active
last_updated: 2026-09-21
last_reviewed: 2026-09-21
review_after: 2026-12-20
tags: []
---

# Project State

- Goal: Maintain a portable OneDrive Personal inventory and missing-file copier.
- Current work: v1.5 automatic folder discovery and one-file ZIP recovery implemented.
- Validation: 55 JavaScript tests pass, including JavaScript ZIP → native
  restoration/cleanup interoperability. Native tests on the development Mac:
  18 pass, two Windows-only skips. Synthetic browser acceptance passed automatic
  directory discovery, preserved originals, ZIP export, cancellation and issue UI.
- Published release remains v1.4.0 until hosted checks and v1.5 release verification.
- Next action: run hosted Windows/macOS/Linux checks, publish v1.5.0 and verify
  its downloaded assets. Then retry Check disk and downloads on the affected
  Windows destination; no per-folder connection is required.
- Boundaries: source GET-only; preserve existing local file contents. Metadata
  restoration previews by default and verifies hashes. Native ZIP cleanup is
  limited to explicit input archives after verified restoration. No account data,
  inventories, credentials, or signed URLs belong in Git.
- Unresolved: exact live Windows folder-access cause is unconfirmed; OneDrive
  sync/cloud-file involvement remains a hypothesis. The native helper rejects
  reparse/placeholder paths and may require a plain recovery destination.
