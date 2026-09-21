---
type: decisions
scope: project
status: active
last_updated: 2026-09-21
last_reviewed: 2026-09-21
review_after: 2026-12-20
tags: []
---

# Decisions

- 2026-09-21: use the existing OneDrive Personal browser session and a local folder picker; no extension, application registration, backend, or runtime dependencies.
- 2026-09-21: public releases use MIT licensing, reviewed source, pinned CI actions, and an allowlisted archive. Preserve a clean public history without account exports or private development history.
- 2026-09-21: existing files, including size conflicts, are preserved. Copies are existence-based; they are not a verified backup or a two-way sync.

- 2026-09-21: browser-only native timestamps are unavailable. Retain the browser
  downloader and add an offline post-download/remediation helper; do not add a
  local server, send cookies to a helper, or re-download matching content.
- Prefer fileSystemInfo dates with explicit service-date fallback. Files require
  SHA-256/SHA-1 verification; folders are separate opt-in and path/type matched.
- Use file descriptors/handles for verification and metadata updates. Preview
  first by default, journal before writing, report precision failures, and
  retain the distinction between creation time and Unix metadata-change time.

- 2026-09-21: user rejects per-folder connection prompts. Recover exact existing
  folder handles automatically from parent listings when named lookup fails;
  never infer that failed enumeration means a missing folder.
- 2026-09-21: each restricted-file ZIP contains one original file. Assemble it
  locally from verified GET content rather than depend on an unobserved Microsoft
  ZIP endpoint. Native extraction is required for restricted names. User-authorized
  ZIP deletion is opt-in and follows destination hash readback; failed ZIPs remain.
