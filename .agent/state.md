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
- Current work: v1.7.0 adds optional two/three streams inside files at least
  256 MiB, with one file active and fallback to one stream on unsupported ranges
  or throttling. Segments retain same-session retry/resume and exact validation.
- Validation: local Node and synthetic Chromium acceptance pass; see validation.md.
- Live Windows: v1.6.1 remains active while v1.7.0 is prepared. The user authorized
  release, installation and operation; start with two large-file streams.
- Next action: publish the validated build, switch the attended recovery run and
  verify live segmented completion. Client progress belongs to its workstream.
- Boundaries: source GET-only; preserve existing local file contents. Metadata
  restoration previews by default and verifies hashes. Native ZIP cleanup is
  limited to explicit input archives after verified restoration. No account data,
  inventories, credentials, or signed URLs belong in Git.
- Unresolved: live range/CORS acceptance and full recovery completion. Junctions
  are references, not separate backup copies; native size comparison does not
  verify content or hydration. Operational evidence belongs to the client project.
