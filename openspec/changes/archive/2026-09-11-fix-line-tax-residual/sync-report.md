# Sync Report: fix-line-tax-residual

## Status

Synced. The change's single delta was merged into `openspec/specs/`; the change folder stays
active until verification and archive in the same pull request.

## Domains synced

| Domain | Operation | Result |
|---|---|---|
| `pricing` | MODIFIED | `Document line tax decomposition (exact)` replaced in full, from 4 scenarios to 6 |

Canonical file written: `openspec/specs/pricing/spec.md`.

## Requirement replaced

- `Document line tax decomposition (exact)` — MODIFIED. The requirement stops delegating the
  reconciliation to "a deterministic rule the design must specify" and states the rule: the
  residual cent goes to the percent tax with the largest `monto`, ties broken by tax id. Two
  scenarios were added — one pins that the assignment does not depend on the order the taxes
  arrive in, the other pins the tie-break — while the four existing scenarios were carried
  over unchanged.

No `ADDED` or `REMOVED` requirement.

## Destructive merge note

A `MODIFIED` replacement is destructive at archive time. The delta carried the complete
requirement block, all four surviving scenarios included, and the replacement was asserted
before writing, so nothing was dropped silently.

## Active same-domain collisions

None. No other active change declares `pricing`, and every other folder under
`openspec/changes/` is archived.

## Validation performed

- The replaced block was asserted to be one complete requirement before writing.
- After the sync the canonical spec lists 8 requirements and 18 scenarios, with
  `Cost-change recompute` and everything below it untouched.
- No file outside `openspec/specs/pricing/spec.md` changed.

## Next

`sdd-archive`, together with this pull request.
