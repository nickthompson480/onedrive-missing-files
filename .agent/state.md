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
- Current work: v1.6.0 is implemented and packaged locally: read-only native
  PowerShell comparison, validated import, missing-file recovery elsewhere,
  three-file recovery sample and repeatable destination checks. Not released.
  Current Windows diagnosis confirmed junctions in the failing destination.
- Validation: 56 JavaScript tests pass, including JavaScript ZIP → native
  restoration/cleanup interoperability. Native tests on the development Mac:
  18 pass, two Windows-only skips. Synthetic browser acceptance passed automatic
  directory discovery, preserved originals, ZIP export, cancellation and issue UI.
- Hosted validation: all four jobs pass at 34e26d5, including Windows native
  ZIP restoration and timestamps. See validation.md for evidence.
- Release: https://github.com/nickthompson480/onedrive-missing-files/releases/tag/v1.5.0
  Published nine-file ZIP downloaded and verified byte-identical to the local
  build, with matching SHA-256 and valid archive integrity.
- Next action: run hosted Windows checks, publish v1.6 and download it onto
  the attended Windows PC for live helper/import/recovery acceptance. The user
  directed proceeding with download/use in response to the publishing request.
  Existing v1.5 remains public until the new release completes.
- Boundaries: source GET-only; preserve existing local file contents. Metadata
  restoration previews by default and verifies hashes. Native ZIP cleanup is
  limited to explicit input archives after verified restoration. No account data,
  inventories, credentials, or signed URLs belong in Git.
- Unresolved: native Windows v1.6 helper/import and recovery still require
  live acceptance. A plain Windows destination downloaded three test files
  successfully with the existing build. Junctions are references, not separate
  backup copies; native size comparison does not verify content or hydration.
