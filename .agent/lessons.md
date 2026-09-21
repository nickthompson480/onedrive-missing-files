---
type: lessons
scope: project
status: active
last_updated: 2026-09-21
last_reviewed: 2026-09-21
review_after: 2026-12-20
tags: []
---

# Lessons

- Bulk delta continuation can use `/root/view.delta`; confined pagination accepts that observed form and rejects unrelated origins and endpoints.
- Large folder populations require an in-memory checkpoint. Exported reports exclude continuation tokens and temporary download URLs.
- Chrome's developer Console may require Ctrl+Enter for multiline scripts, including on macOS.

- APFS can move birth time backward when only an earlier modification time is
  set. Use one fsetattrlist call containing both dates, explicitly retaining
  the old creation value in modification-only mode. Native regression tests
  verify both normal restoration and creation-date preservation.
- Browser metadata refresh needs its own in-memory continuation, independently
  of the inventory checkpoint, so large file populations can pass time budgets.
