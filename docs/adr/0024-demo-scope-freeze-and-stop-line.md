---
status: accepted
---

# Demo scope freeze: the terminal-mmo becomes a finished tech demo, then stops

This project began as an experiment — *can a 2D side-scrolling MMORPG run entirely
in a terminal?* The answer is yes, and the experiment succeeded well enough that the
real ambition has moved on: a separate, non-terminal, commercial 2D side-scrolling
MMORPG built on the same ideas (its own project, not this repo). This ADR records the
decision to **freeze the terminal-mmo as a finished, showable tech demo and stop** —
and exactly where that line sits — so that the bulk of the design tree (the M1–M4 PRD,
the deep combat roadmap) is deliberately *not* built here.

It supersedes the MVP scope in [`docs/PRD.md`](../PRD.md) wherever the two conflict.
The PRD's milestones M1–M4 and most of its "designed-for" systems are now out of scope;
what ships is the arc below and nothing more.

## What the demo is

A persistent, live, SSH-authenticated terminal MMORPG. A player explores a
**hub-and-spoke World** of increasingly dangerous **Fields**, runs a **Dungeon** to
level up, and fights to a **Boss** at the edge of the world, using genuinely deep
commitment-based melee combat. **Solo-fun-first** (the common case is 0–5 concurrent
players), multiplayer-*capable*, and provable as multiplayer by a recorded session
with friends rather than by a persistent crowd.

The one complete arc that defines "done":

> `bunx` → SSH-key auth → claim username → create Avatar → learn controls (`?`) →
> warm up in Field 1 → run the Dungeon to level → push through distance-gated
> Fields 2–3 → defeat the Boss → completion persists. Return later and you are still you.

## Key decisions

### 1. The empty-world problem is solved by *funnelling*, not channelling

A live MMO whose realistic population is 0–5 must never feel dead. Levers, in order of
weight: (a) **solo-fun-first** — already true given the combat depth; (b) **anti-
fragmentation** — invert ADR 0001's soft-cap split. The demo runs **one shared World
with no Channels**: whoever is online is guaranteed to share one set of Towns/Fields.
Asynchronous-presence systems (ghosts, message boards) and scheduled server events were
considered and **cut**.

### 2. Progression is exploration-gated Fields + a repeatable Dungeon faucet + one edge Boss

Open-world monster contention does not scale even at small populations, so the Field is
**not** the grind path. Instead:

- **Fields** are the exploration *spine* — difficulty gated by **distance from the hub**;
  a player's level gates how deep they can venture. Where they *spend* power.
- The **Dungeon** is the reliable progression *engine* — a single, instanced,
  fixed-difficulty, repeatable XP/loot faucet. No difficulty tiers, no procedural
  generation, no matchmaking, no boss inside. Where they *gain* power.
- One authored **Boss** gates the **deepest Field**. Defeating it *is* the terminal
  state ("you have completed the demo"). It is also the combat showcase — the duel
  grammar (telegraphs, dodge, skills) reads on a deliberate boss, not on field trash.

### 3. World shape: 1 Town, 3 Fields, 1 Dungeon, hub-and-spoke

```
                          [ DUNGEON ]   (instanced; entered from Town)
                               |
   [ Field 1 ]——[ TOWN ]——[ Field 2 ]——[ Field 3 ]——> [ BOSS ]
   easy/warmup    hub        mid           hard         climax
```

Net new zones: **3** (2 Fields + 1 Dungeon). Fields branch off Town in different
directions (spokes), not a single corridor.

### 4. Combat is cut to a terminal-friendly, shippable kit

Kept and already built: **attack, dodge (i-frames), block/guard, swat, poise/stagger/
knockback**, plus two **Active skills** (Power Strike, Ground Pound). **Cut:**

- **Parry + Reflect + Lag-compensation** — parry feels finnicky at terminal fidelity and
  is hard to land; cutting it removes Reflect (defined as parrying a Projectile) and makes
  Lag-comp (which exists only to judge parry timing) dead code. Projectiles are then
  countered by **block / dodge / swat** only. **ReactionProfile** nearly collapses to its
  `projectile`/swat branch.
- The entire **juggle / launcher / spike / aerial / combo-cancel** substrate (PRD/issues
  #160, #167, #170) — the largest unbuilt subsystem. Banked for the real game.

### 5. Progression: five levels, each handing one verb

Level cap **5**. The ladder *is* the mechanics tutorial — one tool per level, paced to
arrive just before the world demands it:

```
L1: attack        L2: block        L3: power strike        L4: dodge        L5: ground pound (cap)
```

Ranged pokers live in **Field 2 and deeper only** — a new player (L1, attack-only, no
i-frames until L4) never faces a projectile they cannot answer.

### 6. Identity: SSH-key auth (the one indulgence)

[ADR 0004](./0004-ssh-key-auth.md) is implemented: first launch does challenge-response
against the player's existing SSH key and claims a username bound to it. This is the
demo's signature shareable detail for a developer audience, and the natural persistence
key. Consequently the **Handle stops being ephemeral and becomes a durable claimed
username** (revising ADR 0006).

### 7. Persistence: bun:sqlite, plus a completion flag

Persist: Account (key↔username), Avatar (level/XP/Gold), inventory + equipped Items,
cosmetics (Form/hue/hat/nameplate), last safe Town (always respawn in Town), and a
**Boss-defeated flag** (the persisted proof of completion). Do **not** persist Monsters,
Field/Dungeon transient state, or exact field position.

### 8. Content bill of materials

- **Monsters:** reuse chaser + ranged poker; **2 new** — a heavy melee **brute**
  (Field 3) and the **Boss**.
- **Weapons:** sword-and-shield only, one moveset / one animation set. Weapons vary by
  **stats (damage + affixes) + visuals (sprite + accent colour) only — never playstyle
  or animation** (revising the Weapon stat block's phase-speed/feel role). Loot variety
  comes from **rarity tiers + randomized affixes + recolours**. Dagger/greatsword
  archetypes deferred.
- **Cosmetics:** 2 Forms, 4–5 hats.

### 9. Onboarding: no quest system

Three pieces only: a **controls overlay** (`?`), the **spatial difficulty gradient** as
the tutorial (Field 1 adjacent to Town, danger with distance), and **2–3 signpost NPCs**
giving directional nudges via existing NPC/speech. No quest engine, no scripted starter
objective, and **no north-star HUD line** (discovery stays organic). The level ladder
teaches the verbs.

## Roadmap (build only)

| # | Milestone | Work |
|---|---|---|
| **D1** | **Combat freeze** | Remove parry/reflect/lag-comp; reduce Weapon stat block to damage/affixes + visual; close #160/#167/#170 as out-of-demo; level-gate block(L2)/power-strike(L3)/dodge(L4)/ground-pound(L5); set cap=5 and **rework level scaling & the EXP curve** |
| **D2** | **Backbone** | SSH-key auth + username claim (Handle→durable); persistence (bun:sqlite, scope above + boss-defeated flag); funnel — remove channelling, one shared World |
| **D3** | **World build** | Author 2 Fields + 1 Dungeon (hub-and-spoke; Dungeon = new server instancing); the **brute** Monster; **loot rework** (drop mechanics + rarity visuals + affixes + per-zone tables); 2 Forms + 4–5 hats; distance-gated difficulty tuning. *(Boss is its own epic — see amendment.)* |
| **D4** | **Hub + onboarding** | Controls overlay; 2–3 signpost NPCs; merchant buy/sell wired; **HUD bars (HP + EXP)** |

The glossary cleanups implied above (Parry, Reflect, ReactionProfile, Guard, Lag
compensation, Handle, Weapon stat block, Channel) are applied as part of D1/D2, in one
coherent pass, not piecemeal.

## Amendment (2026-07-01): added scope, the Boss epic, and a stretch goal

Breaking the roadmap into slices (PRD #230 → `/to-issues`) surfaced four adjustments:

1. **The Boss is its own milestone/epic, not a slice.** It needs art design, fight-mechanics
   design, and scaling/balance — not one-shottable by an agent. D2's persistence slice builds
   the **boss-defeated flag plumbing**; the Boss epic wires the *trigger* that sets it. The
   Boss remains the demo's terminal state and combat showcase; only its *tracking* changes.
2. **Loot is a rework, not net-new.** A system already exists (bases, rarity weights, affixes,
   `rollItem`). D3's loot work reworks *how drops behave and how rarity reads visually* (in-world
   and on pickup), on top of the existing roll logic.
3. **Level scaling & EXP is a rework.** Beyond setting cap=5, D1 reworks the scaling curve and
   EXP so the Dungeon is a sane, reliable climb. **Tuning (#266):** the EXP-to-next curve is now
   *geometric* — `xpBase(60) · 2^(L-1)` → **60 / 120 / 240 / 480**, 900 total to the cap — so the
   ask accelerates and the last level is by far the biggest. XP-per-kill is no longer a flat
   constant: it is `MONSTER_XP[type] · ZONE_XP_MULT[zone]`, floored. Monster bases **Slime 5 <
   Sporeling 8 < Golem 14**; zone depth **field-01 ×1, field-02 ×1.5, field-03 ×2, dungeon-01
   ×2.5**. So a Field-1 Slime is a 5-XP trickle (no power-levelling) while a Field-3 Golem pays 28
   and the Dungeon faucet (a Slime at 12) reaches the cap in ~75 kills — the tuned 60–80 window.
4. **HUD gains real bars.** Today the HUD is a single text line; D4 adds visual **HP + EXP**
   bars (the Stamina bar lands with the stretch below).

**Stretch goal — Stamina (not in D1–D4).** A *new* combat resource (absent from the codebase
today): a souls-model action budget consumed by **attacking, dodging, and Active skills**,
regenerating automatically. Kept distinct from **Poise** (Poise = stagger resistance; Stamina =
action budget) so the two never overlap; **block stays on the Poise/guard-break system**. It is
deliberately *out of the frozen demo scope* and will be scoped/planned separately before any
build — the demo ships complete without it, and the HUD's Stamina bar rides along if/when it lands.

## The stop line

Done = the arc in *What the demo is* works end-to-end, persists across sessions, and
multiple players share one funnelled World. **After D4, no new features are added to this
repo.** Every further idea — parry, juggles, more classes, more zones, an economy — is
backlog for the *real game*, a separate project. Showcasing the demo (README, capture,
sharing) is deliberately outside this roadmap: a separate activity, done whenever, owned
by no milestone.

## Status of the PRD and prior ADRs

[`docs/PRD.md`](../PRD.md) remains the historical record of the original ambition but is
**no longer the build target**; this ADR is. Combat ADRs 0017/0019/0022 stand for what
*was* built; the parts they describe that this ADR cuts (parry, reflect, lag-comp,
per-weapon feel) are superseded for the demo. ADR 0004 (SSH auth) moves from designed to
built; ADR 0006's ephemeral Handle is revised to a durable username.
