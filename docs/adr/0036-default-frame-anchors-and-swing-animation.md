---
status: accepted
---

# The Default frame owns anchors; weapons author one `swing` animation; playback and chrome stay live

Sprite-editor QA round 4 (PR #351) hit the one area the mouse-primary rework
(ADR 0035) never reached: anchors. The anchor menu was a keyboard-only modal,
placing an anchor took a click *plus* a spacebar press, override removal was
orphaned code with no trigger, and doc-level anchor deletion didn't exist.
Worse, the doc/frame *scope* of an anchor edit was an invisible menu toggle —
nothing on the canvas said which one you were editing. Separately, weapon
sprites still carried the pre-animation-era `windup`/`active`/`recovery` named
frames, a combat implementation detail leaking into the art format that ADR
0035's `walk` merge had already retired for bodies.

## Decisions

1. **The Default frame — the first Frame in the file — owns the file-level
   anchors. Frame identity, not editor view, decides an anchor edit's scope.**
   Editing an anchor on the Default frame edits the file's defaults; editing one
   on any other frame authors that frame's override. One universal rule for
   every role: canonical order (ADR 0035) makes the Default frame a form's
   `idle`, a weapon's rest frame, a hat's only frame. The editor badges it. No
   scope toggle survives — the invisible `s` switch is deleted with its modal.

2. **Anchors are direct manipulation.** Drag a `✛` marker to move it (scope per
   decision 1); right-click an override marker to clear it back to the default.
   The anchor menu becomes mouse-native — click rows, click `+ new`, and gains
   delete for doc-level anchors (guarded: a role's required anchors can be
   moved, never deleted). Picking an anchor arms placement: the next canvas
   click places it — no spacebar step.

3. **Weapons author a Default frame plus one `swing` animation of exactly three
   frames; the `windup`/`active`/`recovery` frame names retire.** Combat still
   selects by replicated attack phase — wind-up shows `swing` frame 0, active
   frame 1, recovery frame 2 — so timing authority stays in combat data and the
   swing's fps is ignored. Exactly three frames is a validation error otherwise:
   each frame maps to a phase. Time-scaling N frames across phase durations was
   rejected — artistic freedom nobody asked for, bought with owner/observer
   drift risk. Amends ADR 0018's frame naming; its one-posed-layer argument
   stands.

4. **Playback suppresses painting, nothing else.** The playback flag leaves
   `modalActive()`; only canvas paint gestures gate on it. This un-traps
   playback: the stop/mirror/preview controls and rail buttons were dead because
   one upstream guard swallowed every click while playing (the round-3 key cull
   made that visible — the keys that used to escape it were gone). `esc` also
   stops playback.

5. **The serializer preserves compact header formatting.** Anchor coordinates
   and frame lists emit as single-line arrays instead of `JSON.stringify`'s
   exploded multi-line form, so a save touches only what actually changed and
   `.sprite` diffs stay reviewable.

Also in this round, cosmetic: the select tool's in-progress drag rendered
ink-colored pixel blocks (the shape-preview painter leaking into select, which
never paints); it now draws the same dotted marquee as a committed selection,
and select stops capturing the active ink entirely.

## Consequences

- Amends ADR 0018 (weapon frame naming → `swing` indexed by phase), ADR 0020 /
  ADR 0031 (anchor authoring model), ADR 0035 (extends mouse-primary to
  anchors; Default frame builds on canonical order).
- Weapon `.sprite` files migrate (`windup`/`active`/`recovery` → `swing-0/1/2`
  under a `swing` animation) in the same commit as the selection-logic change.
- CONTEXT.md gains **Default frame**; the Anchor and Sprite-role entries follow.
