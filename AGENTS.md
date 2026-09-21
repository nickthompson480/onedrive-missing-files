<!-- codex-project-agents-template: 2 -->
# Codex Project Instructions

This directory is the managed project `tool--onedrive-missing-files` (OneDrive Missing Files).
Work here in **project mode**. Keep project-specific truth in `.agent/` and
implementation in this repository.

## Authority and evidence

Use this order when sources conflict:

1. current user instructions;
2. observed code, tests, data, and runtime behavior;
3. current project-local `.agent` context;
4. root workspace rules and registry data; and
5. historical reports, startup packets, and handoffs.

State uncertainty explicitly. Do not turn assumptions or plans into recorded
facts.

## Start meaningful work

1. Read `.agent/README.md` and `.agent/state.md`.
2. Use `$brief` to inspect only the relevant tasks, decisions, specs,
   workstreams, implementation, and Git evidence. Write the disposable packet
   to `.agent/tmp/startup-packet.md`.
3. Inspect `git status --short` and preserve unrelated work.
4. Consult `../../.agent/` only for shared rules, registry data,
   or explicit cross-project dependencies.

For simple questions that do not depend on project state, a startup packet is
not required.

## Scope and mutation boundaries

- Work only in this project by default.
- Reading root or sibling context for coordination is allowed; editing a
  sibling requires an explicitly coordinated cross-project task.
- Keep project decisions local. Put only portfolio policy, registry changes,
  and cross-project relationships in root context.
- External writes, deployments, publishing, credential changes, and
  destructive operations retain their normal authorization requirements.

## Persist context by default

During meaningful work, update project context when state, tasks, decisions,
validation, risks, lessons, dependencies, or the exact next action materially
change. Use the narrowest appropriate file:

- `state.md` for current position and handoff;
- `tasks.md` for actionable work;
- `decisions.md` for consequential choices and rationale;
- `lessons.md` for reusable, evidence-backed learning;
- `spec.md` for durable scope and acceptance criteria;
- `validation.md` for durable validation commands and latest evidence; and
- `context-gaps.md` for unknowns that affect confidence.

Keep each fact in one canonical place. Do not store raw transcripts, secrets,
credentials, private exports, caches, or speculation presented as fact.

## Validation and done

Meaningful work is complete only when:

- the requested outcome is implemented, answered, or explicitly blocked;
- validation is proportional to risk and any unvalidated area is named;
- durable context reflects changed state, decisions, evidence, and next action;
- Git status has been reviewed and unrelated changes remain untouched; and
- a focused commit is created when authorized or required.

## Debrief before finishing

Before the final response after meaningful work, use `$debrief` without waiting
for an explicit request. Reconcile the worktree, update durable context, record
validation and remaining risks, and leave one exact next action. If no durable
update is warranted, state that plainly.

## Git is the change log

- Use focused commits as the durable record of coherent changes.
- Commit context with the implementation or decision it explains.
- Review and stage explicit paths only.
- Never mix unrelated pre-existing changes into a commit.
- Never stage `.agent/local`, `.agent/private`, `.agent/tmp`, credentials,
  environment files, generated output, or machine-local data.
- Do not push, create remotes, rewrite history, or delete branches without
  explicit user authorization.

## Project-specific operating instructions

- Follow README.md and docs/behavior.md for the supported browser contract.
- Run `npm test`, `npm run format:check`, and `npm run build` for source changes.
- Use only synthetic fixtures in Git. Never commit account exports, browser
  profiles, credentials, temporary download URLs, or private filenames.
- Keep Microsoft operations GET-only and local writes missing-file-only.
- Keep source in `src/`, tests in `test/`, and build utilities in `scripts/`.
- Release artifacts are generated under ignored `dist/`; upload only the
  archive and checksum produced by `scripts/package.py`.
- Changes to UI behavior require browser acceptance appropriate to the change.
  Do not equate hosted Node tests with native browser acceptance.
- This repository is portable outside the personal workspace. If the optional
  parent workspace is absent, use this repository's instructions and context.
