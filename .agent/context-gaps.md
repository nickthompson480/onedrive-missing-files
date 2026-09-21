---
type: context-gap-index
scope: project
status: active
last_updated: 2026-09-21
last_reviewed: 2026-09-21
review_after: 2026-12-20
tags: [context, discovery]
---

# Context Gaps

- Native Windows and Edge browser acceptance is pending.
- Personal Vault, package internals, shortcut targets, and other excluded namespaces are not covered.
- Website API stability and cross-application file-creation races cannot be guaranteed.

- 2026-09-21: User confirmed the Windows destination is inside OneDrive; the
  visible sync arrows indicate syncing/pending status. Explorer visibility does
  not establish ordinary browser filesystem access or hydration. Retry v1.5 automatic lookup on the
  affected destination before further diagnosis. A location comparison may help
  distinguish sync/provider involvement, but no root cause is yet established. No Windows machine access is available
  in this task; this finding comes from user reports and screenshots.
