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
- Current work: v1.1.0 timestamp repair is released and verified.
- Validation: 32 JavaScript tests pass. Native helper tests pass on Windows
  (13), macOS and Linux (12 plus one Windows-only skip). Synthetic browser
  metadata export, stop, and resume passed. Native Windows browser acceptance
  remains pending; no real user files were modified during v1.1 validation.
- Release: https://github.com/nickthompson480/onedrive-missing-files/releases/tag/v1.1.0
  includes the ZIP and SHA-256 checksum. The published download is byte-identical
  to the reviewed local build and passes archive integrity checks.
- Next action: users can export fresh date metadata and preview the local helper
  against their selected copy before applying. Complete separate native Windows
  Chrome/Edge browser acceptance when that environment is available.
- Boundaries: source GET-only; preserve existing local file contents. Metadata
  restoration is separately authorized, previews by default, and verifies hashes. No account data, inventories, credentials, or signed URLs belong in Git.
