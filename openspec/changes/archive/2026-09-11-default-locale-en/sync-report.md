# Sync Report: default-locale-en

## Status

Synced. The change's single delta was merged into `openspec/specs/`; the change folder stays
active until verification and archive in the same pull request.

## Domains synced

| Domain | Operation | Result |
|---|---|---|
| `locale-and-formats` | MODIFIED | `Single business locale` replaced in full, from 1 scenario to 5 |

Canonical file written: `openspec/specs/locale-and-formats/spec.md`.

## Requirement replaced

- `Single business locale` — MODIFIED. The full block from the delta replaced the canonical
  block: the requirement text gained the pre-configuration default and the
  pre-authentication resolution, and the scenarios went from one (`No per-user switch`) to
  five, restoring `The stored choice governs every session` and adding
  `English before the business decides`, `Choosing Spanish in the wizard takes one click`
  and `The pre-authentication screens follow the configured locale`.

No `ADDED` or `REMOVED` requirement: this change modifies one block and nothing else.

## Destructive merge note

A `MODIFIED` replacement is destructive at archive time. The delta carried the complete
requirement block, including its surviving existing scenario, and the replacement was
asserted to contain the delta's block in full before writing — so no scenario was dropped
silently. The scenario the block gained is additive; the only scenario it inherited is the
one it keeps.

## Active same-domain collisions

None. No other active change declares `locale-and-formats`, and every folder under
`openspec/changes/` except this one is archived.

## Validation performed

- The replaced block was asserted to be a single, complete requirement before writing.
- After the sync the canonical spec lists 5 requirements and 10 scenarios — the modified
  requirement going from 1 to 5 — with
  `Formats derived from the locale` and everything below it untouched.
- No file outside `openspec/specs/locale-and-formats/spec.md` changed.

## Next

`sdd-archive`, together with this pull request.
