---
status: accepted, partially supersedes ADR 0024 (the "loot can never change
  playstyle" clause; every other clause of the scope freeze stands)
---

# Shield-gated Block and the Offhand slot

Block has been a level-gated capability (level 2 on the one-verb-per-level
ladder) with a floating overlay glyph for a visual, and ADR 0024 froze loot
into "stats and looks — a weapon can never change playstyle." We want shields
to exist as visible, equippable objects, and we want carrying one to *mean*
something.

## Decision

**Equipping a Shield is what enables Block — and it is the only gate.**
An Avatar with no shield in its offhand cannot raise Guard at all; with one,
Block works from level 1. This knowingly reverses ADR 0024's
loot-never-changes-playstyle clause for this one item kind: the Shield is an
equipment-gated combat verb. The `block` capability leaves the level ladder;
level 2 now unlocks nothing (deliberately a hole — shuffling the remaining
unlocks down would silently speed up the whole power curve, a separate tuning
decision this feature must not smuggle in).

The item model grows a fourth Slot, **`offhand`**, holding a Shield and
nothing else yet.

Scope boundaries that keep the reversal small:

1. **One basic shield exists.** Granted and equipped at Avatar creation;
   existing Saves are migrated on load (grant + equip if the offhand is
   empty). It can be unequipped from inventory — making the gate real and
   observable — but it is **unsellable and untradeable** while it is the only
   shield in existence: with no shield drops in any Loot table, selling it
   would permanently delete a combat verb for pocket change.
2. **The Shield is a stat-less gate.** Fixed common rarity, zero affixes;
   chip ratio and block poise stay shared `COMBAT.guard` constants. A "Shield
   stat block" is a decision for the day a second shield exists.
3. **Present at rest, like the weapon (ADR 0018).** The shield sprite is
   composited onto the Avatar every frame at a new **required `offhand`
   anchor** on Form body sprites, and its catalog id joins the replicated
   appearance — whether someone *can* block is readable at a glance. The
   `guardOverlayGlyph()` overlay is retired.
4. **New Sprite role `shield`** (`sprites/shields/`): a Default frame (the
   rest carry) plus a `block` Animation. Block is a *held state*, not a
   phased one, so `block` is static or fps-looped — never phase-indexed like
   a weapon `swing`. The raise is authored in the shield's own frames; Forms
   owe no new body animation.
5. **Unequipping mid-guard just drops the guard** next tick; no special
   interaction.

## Considered options

- **Shield modifies Block** (always available bare-handed, shield improves
  it): preserved ADR 0024 cleanly, rejected in favor of the equipment-gated
  verb.
- **Purely cosmetic shield**: rejected — the item would mean nothing.
- **Stacking the level gate with the equip gate**: rejected — with the shield
  universal at start the level gate added nothing but a second condition.
