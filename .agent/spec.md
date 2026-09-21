---
type: spec
scope: project
status: active
last_updated: 2026-09-21
last_reviewed: 2026-09-21
review_after: 2026-12-20
tags: []
---

# Specification

Provide a dependency-free browser tool for desktop Chrome/Edge on OneDrive Personal. Enumerate the ordinary My files tree, export sanitized metadata, compare full relative paths under a chosen local directory, and stream missing files into that directory.

Require terminal enumeration without unresolved structural errors before disk operations. Preserve existing paths and size conflicts. Report unsupported namespaces, incompatible paths, incomplete scans, and interrupted copies explicitly. Never upload, delete, or offer an overwrite mode.

The portable release must contain only the launcher, combined script, offline timestamp helper, documentation, and license. It must not contain runtime account data. Test source and artifacts with synthetic fixtures, and keep native-browser acceptance separate from simulated cross-platform CI.


## Timestamp restoration (v1.1)

The user authorizes a version that restores original creation/modification dates
and can remediate existing downloads. Preserve the original browser workflow;
export a sanitized, freshly checked metadata manifest and use an offline native
helper because browser file handles cannot set native dates. Prefer
fileSystemInfo dates with an explicit service-date fallback. Match file contents
using SHA-256 or SHA-1; do not accept size alone or QuickXor as identity. Preview
by default and record before/after metadata when applying. File bytes, names,
and cloud state remain unchanged. Windows/macOS support both dates; Linux must
explicitly request modification-only behavior. Exclude symlinks, reparse points,
hardlinks, traversal paths, and case/Unicode collisions.

## Download visibility (v1.2)
Show the current path, stream progress, average speed, stage and file counts.
Keep stop available across accessible tabs. Provide bounded activity history
and paginated/searchable issues from inventory, disk, downloads and date repair.
Render filenames as text; never expose signed URLs or request credentials.

## Parallel downloads (v1.3)

Offer a 1–5 concurrency setting, default 3 in the UI. Prepare folders before
workers. Reserve shared file/byte budgets before fetch, preserve existing files,
and cancel all active streams on Stop or fatal storage/permission failures.
Show each active file independently; retain activity and issue reporting.

## Windows diagnostics and recovery (v1.4)

Attach controlled operation identifiers and relative paths to local failures,
without exporting raw errors or signed URLs. Classify known browser-restricted
types only following local name rejection. Distinguish empty local mismatches
without asserting their provenance. Support separate-folder comparison copies
of size mismatches; reject overlapping roots and preserve existing recovery
files. A disappearing getFile snapshot remains a conflict. Do not claim a
Windows root cause without runtime evidence.
