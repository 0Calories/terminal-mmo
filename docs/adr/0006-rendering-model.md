---
status: accepted
---

# Rendering: decorative sprites over logical boxes, hybrid composition, sub-cell compositor

## Decisions

- **Rich ASCII sprites, hard-decoupled from logical entities.** Entities are
  rendered as expressive multi-row figures, but the simulation and wire know
  only position + a small logical box. Avatars pass through each other;
  legibility comes from z-ordering (deterministic foot-depth sort, local
  Avatar always on top). Avatars keep one canonical uniform box whatever
  their Form — cosmetics must never change gameplay — while **Monster/NPC
  boxes are derived from their sprite's Default-frame pixel bounds** (the
  uniform box drifted visibly from the art). Attack hitboxes stay authored,
  never derived; per-frame dynamic boxes are rejected (animation must never
  re-couple to gameplay).
- **Split rendering by update frequency, not by feature.** The hot per-frame
  playfield is imperative (one custom Renderable); event-driven chrome (HUD,
  menus, chat log) is retained UI via `@opentui/react`. A virtual-DOM diff in
  front of a buffer that fully invalidates every frame is the mistake to
  avoid; the simulation never enters a render cycle. Per-frame elements
  anchored to moving entities (speech bubbles, nameplates) belong on the
  playfield, not in retained chrome.
- **The playfield composes in sub-cell pixels (four quadrant Pixels per
  terminal cell) before encoding terminal cells once.** Writing straight to
  the terminal collapses transparency too early — a later glyph can only
  blend with a stored background, not the visible shape beneath. The
  compositor owns alpha composition, two-colour reduction, and backdrop
  truth; nothing samples terrain or guesses what's underneath. Actors and the
  camera move at half-cell resolution; explicit back-to-front passes keep
  combat readable over sprites and communication readable over combat
  (bubbles above, nameplates below the feet — disjoint bands that never
  collide).
- **Presentation is client-realized from authoritative events.** Particles,
  sound effects, damage numbers, hitstop, and camera-kick all realize
  CombatEvents (ADR 0005) locally; particle bursts use local randomness
  (pixel-lockstep buys nothing a player can observe), sound is best-effort
  through OpenTUI's native mixer with synth-generated chiptune sources (no
  binary assets to ship), and every effect is a named definition file — a new
  look is a new file, not new code. The shared sim is byte-identical whether
  or not anyone can see or hear it.
