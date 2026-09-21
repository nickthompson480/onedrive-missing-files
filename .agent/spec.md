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

The portable release must contain only the launcher, combined script, documentation, and license. It must not contain runtime account data. Test source and artifacts with synthetic fixtures, and keep native-browser acceptance separate from simulated cross-platform CI.
