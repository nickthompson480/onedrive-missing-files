---
type: context-gap-index
scope: project
status: active
last_updated: 2026-09-28
last_reviewed: 2026-09-28
review_after: 2026-12-20
tags: [context, discovery]
---

# Context Gaps

- Native Windows and Edge browser acceptance is pending.
- Personal Vault, package internals, shortcut targets, and other excluded namespaces are not covered.
- Website API stability and cross-application file-creation races cannot be guaranteed.

- 2026-09-28 attended Windows Chrome: the reproduced create_local_folder
  NotFoundError parent is a Windows Junction targeting another local folder.
  Three small files succeeded in a new plain Downloads directory. Native
  metadata inspection found many browser-missing files present through the
  junctions. This resolves the cause of the reproduced parent failure, not all
  possible filesystem errors. No junction or original content was changed.
- v1.6 uses a read-only PowerShell check and validated import to recover missing
  or differing files into a separate ordinary folder. Local PowerShell 7 and
  browser UI checks and hosted Windows PowerShell 5.1 checks passed. The v1.6 release
  passed live helper/import/three-file recovery acceptance. Live v1.6.1
  large-file acceptance also passed; full recovery remains pending.
  v1.6.2 same-session resume passes synthetic tests but requires live readable
  Content-Range and an unchanged version tag. It deliberately fails closed if
  browser CORS hides range evidence; reload/Stop has no persistent checkpoint.
  The remote PC has no `py` launcher. Browser overlap checks
  cannot certify absence of native aliases; recovery must use an ordinary
  folder without junctions. Equal-size metadata does not verify contents.
- Private endpoint paths/reports, operational counts and attended-session
  handoff belong to client--unity-church-digital-operations, not public fixtures.
