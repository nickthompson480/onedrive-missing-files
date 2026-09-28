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
- Current work: v1.6.0 is released and loaded on the attended Windows PC.
  It adds read-only native PowerShell comparison, validated import, missing-file
  recovery elsewhere, a three-file recovery sample and repeat destination checks.
- Validation: 58 JavaScript tests pass; 18 Python tests pass on the development
  Mac with two Windows-only skips. Synthetic Chromium recovery acceptance passes.
  All four hosted jobs passed at 23494f0 (run 36466339839), including the native
  checker under Windows PowerShell 5.1 and PowerShell 7.
- Release: https://github.com/nickthompson480/onedrive-missing-files/releases/tag/v1.6.0
  The published 11-file ZIP matches the local build byte-for-byte. Its SHA-256
  was also verified after downloading and expanding it on the attended PC.
- Next action: run the native checker, import its report and test live separate
  recovery. Temporary process-scoped RemoteSigned approval is pending because
  that PC uses Restricted execution policy. Its permanent policy is unchanged.
  The updated browser tool completed the live source inventory without issues.
- Boundaries: source GET-only; preserve existing local file contents. Metadata
  restoration previews by default and verifies hashes. Native ZIP cleanup is
  limited to explicit input archives after verified restoration. No account data,
  inventories, credentials, or signed URLs belong in Git.
- Unresolved: native Windows v1.6 helper/import and recovery still require
  live acceptance. A plain Windows destination downloaded three test files
  successfully with the existing build. Junctions are references, not separate
  backup copies; native size comparison does not verify content or hydration.
