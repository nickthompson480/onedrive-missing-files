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

The v1.0 baseline had 26 passing local synthetic tests, including continuation, URL confinement, conflict handling, preservation races, truncation, bounded samples, permission failures, and launcher source round-trip validation. The combined browser script passes syntax checks. The release ZIP passes integrity checks and has an explicit allowlist (seven files in v1.1).

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
  junction test skipped. The final 32-test JavaScript suite and native suite pass in all four jobs
  of hosted run 35642434830 at commit 630b252. Commands:
  `python3 -m unittest discover -s test -p 'test_*.py' -v`,
  `ruff check native/repair-dates.py test/test_repair_dates.py scripts/package.py`.

- The final synthetic browser check stopped after one refreshed file, exported a
  partial manifest, then resumed and exported both files with correct dates and
  hashes. No private sentinel fields appeared in either export.
- Published v1.1.0 ZIP and checksum were downloaded and verified byte-for-byte
  against the reviewed local build; seven-file allowlist and ZIP integrity pass.
  Public source and archive checks found no private account identifiers from
  the supplied request or credential-bearing request values.

## Version 1.2 evidence

34 JavaScript tests pass, including live transfer stages, committed byte counts,
existing-file skips, sanitized failures, and issue collection across four sources.
Synthetic browser checks verified 50% progress, byte/speed/count display, issue
pagination (62 entries), search, conflict sizes and text-only unusual paths.
Native Windows live browser acceptance remains pending.

Final synthetic UI also verified completed activity history, 100% completion,
and disabling Stop after the run finished.

All four hosted CI jobs passed at 3043f27 (run 35643549750). The published
v1.2.0 seven-file ZIP was downloaded and matched the local build byte-for-byte;
its SHA-256 and archive integrity checks passed.
