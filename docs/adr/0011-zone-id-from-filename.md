---
status: accepted
---

# A Zone's id is its filename, not a header field

> Vocabulary: [`CONTEXT.md`](../../CONTEXT.md) — Zone id, Zone name, Portal.
> Amends the `.zone` format from [ADR 0008](./0008-data-driven-zones.md).

ADR 0008 put `id` in the `.zone` header (`parseZone` requires
`header.id` — `zoneFormat.ts`), so identity lives in two places at once: the
filename `zones/<id>.zone` *and* the header field. They can silently drift, and
the editor would otherwise have to police the duplication.

This ADR records the decision to make the **filename the single source of truth
for a Zone's identity**.

## Decision

- **`id` is derived from the filename** (`zones/verdant-field.zone` → id
  `verdant-field`) and is **removed from the header.** The header carries only
  `type`, the optional display `name`, and the (editor-managed) glyph maps.
- **`parseZone` takes the id from the path**; `newZoneTemplate` stops emitting an
  `id` line; the shipped `.zone` files drop theirs.
- **Renaming a Zone = renaming the file**, plus rewriting every Portal `target`
  that references it — a mechanical cross-zone refactor served by a dedicated
  `zone rename <old> <new>` CLI command, *not* an in-editor live edit.

## Consequences

- A format migration touching every `.zone` file, `parseZone`, `newZoneTemplate`,
  and the loader (which must thread the filename through as the id).
- Identity-as-wrong becomes unrepresentable: no header field to disagree with the
  path. This mirrors the [Zone id vs Zone name](../../CONTEXT.md) split (a label
  is not an identity — cf. Handle).
- A `.zone` file is no longer fully self-describing in isolation (its id depends
  on its path) — the accepted trade-off for a single source of truth.
