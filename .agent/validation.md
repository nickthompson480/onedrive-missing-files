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

Hosted CI passes on Windows/macOS/Linux with Node 24 and on Linux with Node 22.
`.gitattributes` enforces consistent LF checkouts. The published v1.0.0 ZIP was
downloaded, checksum-verified, and compared byte-for-byte with the local build.
The archive rebuild is deterministic. Native Windows/Edge sign-in, folder permission, long-path behavior, and live downloads need acceptance testing. Simulated filesystem tests do not prove native browser behavior. Keep the destination idle; browser APIs do not guarantee atomic create-if-absent against unrelated applications.


## Version 1.1 evidence

- 32 JavaScript tests pass, including filesystem/service date separation, fresh
  metadata validation, privacy filtering, limits, and repair-bundle coverage.
- 13 native Python tests run on the development Mac: 12 pass and the Windows
  junction-specific test is skipped. Creation/modification apply and readback
  use real disposable files, not mocked timestamp setters. The suite also tests
  the APFS birth-time clamp avoided by setting both attributes together.
- A real browser UI test with synthetic metadata exported original dates and
  hashes and excluded a private-field sentinel. No live account export or
  authenticated request supplied by the user was published or executed.
- Native Windows CI passed all 13 tests, including creation/modification and
  junction rejection. macOS/Linux passed 12 tests with the Windows-specific
  junction test skipped. The new metadata-continuation test passes locally;
  hosted CI for that final addition is pending. Commands:
  `python3 -m unittest discover -s test -p 'test_*.py' -v`,
  `ruff check native/repair-dates.py test/test_repair_dates.py scripts/package.py`.
