# openspec — SDD Artifact Store (tempos)

This directory holds the Spec-Driven Development (SDD) artifacts for the
tempos project. It operates in **hybrid mode**: every artifact is persisted
to Engram under a deterministic topic key AND mirrored here as a file.

## Layout

- `config.yaml` — project SDD configuration: stack context, strict TDD flag,
  testing commands, and per-phase rules.
- `specs/{domain}/spec.md` — source-of-truth main specs (a change's deltas are merged
  here by the sync that precedes its archive).
- `changes/{change-name}/` — one folder per active change:
  `proposal.md`, `specs/` (delta specs), `design.md`, `tasks.md`,
  `verify-report.md`, and `apply-progress.md` while it is being applied.
- `changes/archive/YYYY-MM-DD-{change-name}/` — completed changes. The
  archive is an audit trail: never delete or modify archived changes.

## Conventions

- File paths mirror Engram topic keys: `sdd/{change-name}/{artifact-type}`.
  Recovery works from either store.
- Deltas are merged into `specs/{domain}/spec.md` when a change is synced, and the change
  keeps its folder until it is archived under `changes/archive/`.
- `AGENTS.md` at the repo root is the always-on index: the working rules plus a
  pointer to the file that owns each contract. Behaviour lives in `openspec/specs/`.
