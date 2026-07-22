# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This is a **single-context** repo: one `CONTEXT.md` + `docs/adr/` at the root.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the domain glossary (Player, Avatar, Zone, Field, Town, Channel, Monster, Combat, Class, Item, Terrain, Authority model, …).
- **`docs/adr/`** — read ADRs that touch the area you're about to work in:
  - `0001-world-topology-and-authority.md`
  - `0002-tech-stack.md`
  - `0003-visual-architecture.md`
  - `0004-ssh-key-auth.md`

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The producer skill (`/grill-with-docs`) creates them lazily when terms or decisions actually get resolved.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/grill-with-docs`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0001 (world topology and authority) — but worth reopening because…_
