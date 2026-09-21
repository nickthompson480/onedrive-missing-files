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
- Current work: v1.5 automatic folder discovery and one-file ZIP recovery released and verified.
- Validation: 56 JavaScript tests pass, including JavaScript ZIP → native
  restoration/cleanup interoperability. Native tests on the development Mac:
  18 pass, two Windows-only skips. Synthetic browser acceptance passed automatic
  directory discovery, preserved originals, ZIP export, cancellation and issue UI.
- Hosted validation: all four jobs pass at 34e26d5, including Windows native
  ZIP restoration and timestamps. See validation.md for evidence.
- Release: https://github.com/nickthompson480/onedrive-missing-files/releases/tag/v1.5.0
  Published nine-file ZIP downloaded and verified byte-identical to the local
  build, with matching SHA-256 and valid archive integrity.
- Next action: load v1.5 on the affected Windows machine, scan, choose the
  destination root once, Check disk and Download missing. No per-folder
  connection is required; live acceptance remains pending.
- Boundaries: source GET-only; preserve existing local file contents. Metadata
  restoration previews by default and verifies hashes. Native ZIP cleanup is
  limited to explicit input archives after verified restoration. No account data,
  inventories, credentials, or signed URLs belong in Git.
- Unresolved: exact live Windows folder-access cause is unconfirmed; OneDrive
  sync/cloud-file involvement remains a hypothesis. The native helper rejects
  reparse/placeholder paths and may require a plain recovery destination.
