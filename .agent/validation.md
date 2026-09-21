---
type: validation
scope: project
status: active
last_updated: 2026-09-21
last_reviewed: 2026-09-21
review_after: 2026-12-20
tags: [validation]
---

# Validation

## Commands

- `npm ci --ignore-scripts`
- `npm test`
- `npm run format:check`
- `npm run build`
- `python3 scripts/package.py`
- `git diff --check`

## Evidence

26 local synthetic tests pass, including continuation, URL confinement, conflict handling, preservation races, truncation, bounded samples, permission failures, and launcher source round-trip validation. The combined browser script passes syntax checks. The release ZIP passes integrity checks and has an explicit five-file allowlist.

## Gaps

Hosted CI and public release verification are pending. Native Windows/Edge sign-in, folder permission, long-path behavior, and live downloads need acceptance testing. Simulated filesystem tests do not prove native browser behavior. Keep the destination idle; browser APIs do not guarantee atomic create-if-absent against unrelated applications.
