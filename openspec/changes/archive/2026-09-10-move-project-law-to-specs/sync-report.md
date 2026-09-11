# Sync Report: move-project-law-to-specs

## Status

Synced. The change's delta specs were merged into `openspec/specs/`; the change folder
stays active until verification and archive.

## Domains synced

| Domain | Operation | Result |
|---|---|---|
| `transactional-integrity` | new capability | Copied as a full spec (5 requirements) |
| `documents` | new capability | Copied as a full spec (7 requirements) |
| `catalog` | new capability | Copied as a full spec (5 requirements) |
| `counterparties` | new capability | Copied as a full spec (5 requirements) |
| `cash-sessions` | new capability | Copied as a full spec (4 requirements) |
| `payments` | ADDED | 1 requirement appended (7 total) |
| `post-sale-actions` | REMOVED | 1 requirement deleted (6 total) |
| `print-configuration` | REMOVED | 1 requirement deleted (3 total) |

Canonical files written:

```
openspec/specs/transactional-integrity/spec.md   (new)
openspec/specs/documents/spec.md                 (new)
openspec/specs/catalog/spec.md                   (new)
openspec/specs/counterparties/spec.md            (new)
openspec/specs/cash-sessions/spec.md             (new)
openspec/specs/payments/spec.md                  (updated)
openspec/specs/post-sale-actions/spec.md         (updated)
openspec/specs/print-configuration/spec.md       (updated)
```

## Requirements added

- `Standalone receipts allocate oldest-first` (payments)

## Requirements removed

- `Client regeneration after OpenAPI changes` (post-sale-actions)
- `Client regeneration after OpenAPI changes` (print-configuration)

Both removals are destructive canonical changes. They were explicitly approved as D5 in
the change's proposal, and each removed block was the last requirement in its file,
verified before deletion. The removal notes with reason and migration guidance stay in
the change's delta specs.

## Active same-domain collisions

None. `move-project-law-to-specs` is the only active change, and no other change under
`openspec/changes/` (excluding `archive/`) declares specs for these domains.

## Validation performed

- Every created canonical spec starts with a `# ` title and carries both `## Purpose` and
  `## Requirements`, so none of them landed as a delta.
- Requirement counts after the sync: 12 canonical specs, one requirement each of the
  removed pair gone, `payments` gained exactly one.
- No canonical file outside the eight above was touched.
- `openspec/specs/` was the only tree modified; no code, schema or generated client.

## Findings to carry forward

**Five canonical specs are still delta-shaped.** `payments`, `post-sale-actions`,
`print-configuration`, `product-search` and `sell-screen` open with `# Delta for <domain>`
and `## ADDED Requirements` instead of a title, a purpose and a requirements section, a
result of earlier syncs copying change deltas verbatim. Only `locale-and-formats`,
`pricing` and the five specs created here are proper full specs. This does not change any
contract, but it makes the canonical store inconsistent — a reader cannot tell a delta
from a specification — and it is worth a small normalisation change of its own. It is
deliberately **not** done here: it would rewrite five files unrelated to this change.

## Next

`sdd-archive` once the pull request that turns `AGENTS.md` into the index lands and the
change verifies clean.
