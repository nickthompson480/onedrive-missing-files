---
type: tasks
scope: project
status: active
last_updated: 2026-09-21
last_reviewed: 2026-09-21
review_after: 2026-12-20
tags: []
---

# Tasks

- [x] Extract standalone source, synthetic tests, and a portable build.
- [x] Document installation, privacy, limits, and platform acceptance status.
- [x] Add a bounded three-file test and guard closing the panel during disk work.
- [x] Validate tests, formatting, artifact contents, and archive integrity locally.
- [x] Publish the repository and verify hosted CI.
- [x] Publish v1.0.0 with ZIP and SHA-256 checksum assets; download and verify
  the published payload against the reviewed local archive.
- [ ] Complete native Windows Chrome/Edge browser acceptance.

## Version 1.1 timestamp repair

- [x] Preserve fileSystemInfo dates and source hashes without exporting credentials.
- [x] Add fresh, bounded date-repair manifest export and offline native helper.
- [x] Test preview/apply/idempotence, mismatches, symlinks, hardlinks, folder opt-in,
  journal failure, limits, and Mac birth-time preservation using disposable files.
- [x] Exercise metadata-export UI with synthetic browser data.
- [x] Pass native Windows/Linux/macOS CI and publish the v1.1 release; verify
  downloaded release assets against the local build.

## Version 1.2 progress and issues

- [x] Add throttled per-file progress, stages, activity and searchable issues tabs.
- [x] Validate synthetic browser interactions and hosted cross-platform checks.
- [x] Publish v1.2.0 and verify downloaded release assets.
