# Sync Report: unify-locale-and-formats

**Status: synced** — 2026-09-09

## Domains synced

- `locale-and-formats` — **new canonical spec**: no
  `openspec/specs/locale-and-formats/spec.md` existed, so the change's full
  domain spec was copied verbatim as the canonical spec
  (`openspec/specs/locale-and-formats/spec.md`).

## Operations applied

None (new-domain copy; no ADDED/MODIFIED/REMOVED delta sections — the change
spec is a full spec, written in the new-domain format).

## Requirements now canonical (5)

- Single business locale
- Formats derived from the locale
- Centralized formatting helpers
- Locale change propagation
- Extensible locale enumeration

## Collisions

- No other active change under `openspec/changes/` touches
  `specs/locale-and-formats/` (the only active change is this one).

## Preconditions checked

- `verify-report.md` present and PASS (no FAIL/BLOCKED/CRITICAL).
- No unchecked implementation tasks in `tasks.md`.
- Not a legacy flat `spec.md` (domain-shaped `specs/locale-and-formats/spec.md`).

## Next recommended phase

`sdd-archive` — clean path: verify PASS + sync complete + zero unchecked
implementation tasks.
