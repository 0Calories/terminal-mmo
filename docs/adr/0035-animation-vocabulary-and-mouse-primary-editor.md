---
status: accepted
---

# "Animation" replaces "Pose"; one distance-indexed walk; the sprite editor is mouse-primary

Sprite-editor QA (PR #351, rounds 2–3) kept tripping over vocabulary and
interaction choices that dated from before the editor existed. "Pose" meant one
thing in the glossary, collided with **Preview stance**, and read as rig-speak to
an author staring at a strips view of *animations*. The `walkA`/`walkB` gait
lived as two hard-coded single-frame poses in the sim's type union — an engine
implementation detail leaking into every sprite file and the editor UI. And the
editor had accreted a key for everything, burying the handful of keys that
matter under a keymap nobody could hold in their head.

## Decisions

1. **"Animation" is the term; "pose" is retired — at every layer, hard.**
   User-visible editor text, forge internals, `@mmo/core` types (`PoseId` →
   `AnimationId`, `poseFps` → `animationFps`, …), and the `.sprite` format key
   (`poses:` → `animations:`). No back-compat alias in the parser: the repo is
   the entire universe of `.sprite` files, so every file migrates in the same
   commit and legacy-key support would be dead weight. "Frame" is unchanged and
   remains the term for one grid.

2. **`walkA`/`walkB` merge into one `walk` animation; the gait is
   distance-indexed into its frames.** `bodyFrame` selects the `walk` animation
   with `frameIndex = stride % frameCount` instead of alternating two poseIds.
   Same visual result for two frames, but the gait generalizes: an artist adds a
   third walk frame and the engine uses it, no type change. Walk stays
   distance-driven (ADR 0020's replication argument is untouched — this amends
   *how frames are named*, not *when they change*). A form's required set
   becomes `idle` + `walk`.

3. **Canonical animation order lives in the data, not the editor.** The strips
   view keeps honoring file order — the editor stays a faithful mirror, and the
   artist orders by construction. The migration rewrite emits `idle, walk, jump,
   then existing order` so every form surfaces idle first. No editor-side
   pinning: a special case that lies about file contents and has no answer for a
   sprite without `idle`.

4. **The editor is mouse-primary; the keyboard earns its keys.** Three buckets
   survive: cursor movement + paint (arrows/`wasd`, `space`), high-frequency
   convenience (undo/redo, save, quit, `?`, pencil, copy/clear, zoom, numeric
   tool selection), and modal navigation (`tab`/`enter`/`esc`). Everything else
   — frame/animation stepping, menus, tool letters, mirror/onion/resize/crop,
   play, eyedrop — is mouse-only: rail buttons, clickable strips, alt-click
   eyedrop, double-click a swatch to define/edit a color. Rationale: every bound
   key must be hinted, learned, and kept collision-free; below some usage
   frequency a key costs more than it saves, and the rail button it duplicates
   is self-labeling.

5. **Per-animation fps is finally author-editable.** ADR 0031 made fps the one
   timing knob an artist owns, but only hand-editing the file could turn it.
   Multi-frame strips get an in-place mouse stepper; the default (5) is omitted
   on save, keeping files clean.

## Consequences

- Amends ADR 0020 (vocabulary; the two-pose walk mechanism) and ADR 0031 (the
  `poses:` key; fps knob now surfaced). Their replication and format arguments
  stand.
- `PoseId`'s closed union loses its reason to enumerate gait variants; walk
  frame count is data.
- Every `.sprite` file is rewritten once (key rename, walk merge, canonical
  order) in the same commit as the code rename, keeping `sprites:check` green
  with no transition window.
