# ADR index

Eight consolidated records of the project's high-level, hard-to-reverse
decisions. Each distills the decision, why, and the rejected alternatives that
still bind. Read the ones touching the area you are changing. (These replaced
45 fine-grained historical ADRs in 2026-08; the originals live in git history.)

| #    | Title | Covers |
| ---- | ----- | ------ |
| 0001 | Premise and stack | Terminal MMO; TypeScript/Bun/OpenTUI; `bunx` delivery; Kitty-input nudge |
| 0002 | World, authority, and wire | One funnelled World of Zones; client owns movement, server owns consequences; pure sim in `@mmo/core`; binary protocol; intents |
| 0003 | Identity and persistence | SSH-key auth; generated fallback identity; durable Handles; durable Saves; client config |
| 0004 | Hosting and releases | Railway; contract-hash gate; selective shipping; deploy-first/publish-last; roll-forward |
| 0005 | Combat model | Phased commitment; poise; momentum body; Dodge + shield-gated Block; Strikes; CombatEvents on wire; the parry/juggle cut |
| 0006 | Rendering model | Decorative sprites over logical boxes; imperative playfield + retained chrome; sub-cell compositor; client-realized presentation |
| 0007 | Content as data | `.zone` and `.sprite` formats; catalogs by reference; `@mmo/assets`; forge editors |
| 0008 | Package structure | core/render/assets split; deep modules via subpath exports; narrow views |
