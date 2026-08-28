# openspec — SDD Artifact Store (tempos)

This directory holds the Spec-Driven Development (SDD) artifacts for the
tempos project. It operates in **hybrid mode**: every artifact is persisted
to Engram under a deterministic topic key AND mirrored here as a file.

## Layout

- `config.yaml` — project SDD configuration: stack context, strict TDD flag,
  testing commands, and per-phase rules.
- `specs/{domain}/spec.md` — source-of-truth main specs (deltas are merged
  here when a change is archived).
- `changes/{change-name}/` — one folder per active change:
  `state.yaml`, `exploration.md` (optional), `proposal.md`, `specs/` (delta
  specs), `design.md`, `tasks.md`, `verify-report.md`.
- `changes/archive/YYYY-MM-DD-{change-name}/` — completed changes. The
  archive is an audit trail: never delete or modify archived changes.

## Conventions

- All artifacts are written in English (project language rule, AGENTS.md).
- File paths mirror Engram topic keys: `sdd/{change-name}/{artifact-type}`.
  Recovery works from either store.
- `state.yaml` is the DAG state for a change and survives context compaction.
- Project law lives in `AGENTS.md` at the repo root and always wins.
