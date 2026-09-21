---
type: guide
scope: project
status: active
last_updated: 2026-09-21
last_reviewed: 2026-09-21
review_after: 2026-12-20
tags: [project]
---

# OneDrive Missing Files Agent Context

This directory is the operational context for `tool--onedrive-missing-files`. Read `state.md`
first, then only the relevant spec, tasks, decisions, workstream, validation,
or handoff records. Keep durable context current with the Git-tracked work it
explains.

Root workspace conventions coordinate shared concerns; this project's `.agent`
is authoritative for project-specific work.

## File map

- `state.md`: current goal, status, work, next action, blockers, and risks.
- `tasks.md`: actionable work and ownership.
- `spec.md`: durable scope, non-goals, acceptance criteria, and open questions.
- `context.md`: stable constraints and source-of-truth notes.
- `decisions.md`: consequential choices, rationale, alternatives, and effects.
- `lessons.md`: reusable, evidence-backed learning.
- `validation.md`: safe commands, latest evidence, and known validation gaps.
- `context-gaps.md`: unknowns that materially affect confidence.
- `workstreams/`: active multi-step work, including bounded Technical
  Feasibility Spikes, that needs more detail than `state.md`. Start a TFS from
  the workspace `.agent/templates/technical-feasibility-spike.md` template and
  run it with `$run-technical-feasibility-spike`.
- `handoffs/`: paused, transferred, or unusually detailed handoffs.
- `logs/`: durable operational logs only, never raw session transcripts.
- `archive/`: superseded context retained for history.
- `local/`, `private/`, and `tmp/`: ignored machine-local, sensitive, and
  disposable data.

Keep each fact in one canonical file. Current user direction and observed
code, tests, data, and runtime behavior override stale context.
