# Handoff: Zone editor placement/erase UX follow-ups

Working doc for a design "grilling" session, then implementation. Captures four UX
problems found while QA-ing **PR #110 / issue #96** (placement feedback: ghost
footprint, ground-snap, airborne tint). None of these four are tracked by an existing
GitHub issue. The nearest is **#97** (Portals & data-carrying placeables —
"edit-on-click", "Monsters/NPCs just move/delete via Select"), which overlaps the
*move/delete* surface but says nothing about placement gesture, placement origin,
erase hit-area, or palette discoverability.

---

## ✅ Resolved design (grill outcome — 2026-06-22)

The grill is complete; this section is the implementation spec. The original
problem write-ups below are kept for context. **Filing:** tracked by
**[#114](https://github.com/0Calories/terminal-mmo/issues/114)** ("zone-editor:
placement & erase interaction polish") under epic **#91**, shipped as **one PR**.

A central decision reshaped the surface: **the bottom palette bar + `tab` cycle is
retired.** Terrain is the only non-entity Placeable (`#`, single type), so it needs
no selector; entity selection moves into a **modal picker** owned by a new **Stamp**
tool. This subsumes Problem 1.

### Geometry — pure, unit-tested (`editor.ts` seam, `editor.test.ts` RED→GREEN)

1. **Center-origin** via one new pure helper `cursorToAnchor(p, cx, cy, freePlace)`
   → top-left anchor. Used by ghost render, `stampAt`, and the erase hit-test so
   they never drift.
   - **x (always):** `cx - floor(w/2)` — cursor tracks the sprite's horizontal
     visual center (sprite is centered horizontally in its box; 7-wide sprite over
     5-wide `BOX` overhangs symmetrically).
   - **y:** driven by the **existing `f` free-place toggle** (one switch owns snap
     *and* anchor — no per-cell auto, no mid-move jumps):
     - `f` ON (snap off) → cursor = center → `cy - floor(h/2)`.
     - `f` OFF (snap on) → cursor = feet → `cy - (h-1)`, then existing `groundSnap`
       drops the box to the surface.
   - **Invariant:** stored grid glyph stays the top-left anchor (ADR 0008). Zero
     file-format / engine / validator change.

2. **`entityAt(doc, x, y)`** — new pure helper → `{originX, originY, placeable} |
   undefined`. Enumerate placed entities (row-major scan, as `parseZone` does), keep
   those whose `footprintBox` contains `(x,y)`, and return the **renderer-topmost**:
   sort by **(1)** layer `monster > npc > portal` (renderer draw order,
   `render.ts:209-242`), **(2)** larger anchor `y` (drawn later → on top), **(3)**
   later-in-scan. Deterministic from the doc, survives save/reload, matches what the
   author sees. One shared hit-test reused by erase now, move + edit-on-click (#97).

### Interaction — eyeball / HITL in a real terminal

3. **New `Stamp` tool** (name "Stamp", keybind **`p`**, digit **6**). Opens a
   **modal entity-picker**: grouped list (**Monsters / NPCs** now; Structures/portals
   added by #97), navigate with arrows / `jk` + Enter, digit quick-pick, mouse-click
   a row, Esc cancels. **Pick once → modal closes → Stamp stays active → "pick once,
   stamp many."** (Type-to-filter is a future follow-up.) No existing modal primitive
   — reuse the bordered-box pattern from `client/src/playfield.ts` (`drawOverheadBox`),
   render last, capture keys via an early return like the `pendingQuit` flag.

4. **Drag-place gesture** (entities never continuous-paint):
   - **Mouse:** down = pick up ghost → drag = reposition (live ground-snap) → up =
     commit **one** (a plain click is a zero-length drag → one placement).
   - **Keyboard:** in Stamp mode the ghost tracks the cursor (wasd/hjkl/arrows, live
     snap); **space = place one**. The cursor *is* the ghost — no pickup/drop two-press.

5. **Erase hits anywhere in the footprint** — `eraseAt` routes through `entityAt`:
   clicking any cell of an entity removes the topmost entity covering it (erase at the
   resolved origin).

6. **Brush / Rectangle / Line become terrain-only** (always paint `#`); simplify
   `commitGesture` accordingly. Stamp is the only entity placer.

7. **Drop the Eyedropper tool** entirely. Tool row renumbers:
   **1 Brush · 2 Eraser · 3 Rectangle · 4 Line · 5 Select · 6 Stamp**.

### Deferred to #97 (boundary fixed)

- Re-grabbing / moving existing entities; edit-on-click.
- Data-carrying portals (the Structures group in the modal).
- `entityAt` is the shared hit-test these will reuse — built now, consumed later.

### Tests

- Pure helpers `cursorToAnchor` + `entityAt` get RED→GREEN `editor.test.ts` coverage.
- Tool / modal / render / mouse changes are eyeball-only per the PRD (HITL sign-off).

> Read first: `CONTEXT.md` (Zone editor / Placeable / Palette / Tool glossary),
> `docs/adr/0010-entity-centric-zone-editor.md`, `docs/adr/0008-*` (anchor model),
> issue **#91** (epic, 13 locked design points). These four are UX refinements of
> slices D (#95 tools) and E (#96 placement feedback).

## Where the code lives

All in `packages/zone-tools/src/editor.ts` unless noted.

- **Pure seam (unit-tested):** `footprintBox` / `placementState` / `groundSnap` (#96),
  `placeableAt` (`:309`), plus `place` / `erase` in `placeable.ts`.
- **Shell (eyeball-only, `runEdit`):**
  - palette: `flattenPalette` (`:546`), `palette`/`selIdx` state (`:591`),
    `paletteHits` (`:610`), palette bar render (`:850`), `tab` cycle (`:1143`).
  - placement: `placeAnchor` (`:918`), `stampAt` (`:924`), `eraseAt` (`:931`),
    `toolPrimary` (`:938`).
  - mouse: `onMouseDown` (`:994`), `onMouseDrag` (`:1022`, brush drag-paint `:1035`),
    `onMouseUp`/`onMouseDragEnd` (`:1046`).
- **Anchor model:** the grid glyph cell **is** the box's top-left corner. `parseZone`
  builds `{x, y, w, h}` from the glyph position (ADR 0008); `footprintBox` mirrors it.
  Dims live in `shared/constants.ts` (`BOX` 5×5, `NPC_BOX` 4×5, `PORTAL_BOX` 4×7).

---

## Problem 1 — Palette: how to switch the entity to place is not discoverable

**Symptom:** unclear how to pick *which* entity (Monster/NPC/Portal) the Brush stamps.

**Current behavior:** the bottom palette bar lists every flattened Placeable
(`Solid`, then each catalog Monster, NPC, …), active one `[bracketed]` + highlighted.
You switch by **`tab`** (cycle) or **clicking** the label. `flattenPalette` (`:546`)
**drops the group labels** (Terrain / Monsters / NPCs / Structures), so the bar is a
flat run of names with no affordance signaling it's the selector or that `tab` cycles.

**Desired:** make entity selection obvious and fast (groups visible; a hinted key;
maybe a number row or a vertical palette panel). Keep full no-mouse parity.

**Design questions for the grill:**
- Keep the one-line bar (add group separators + a `tab`/`[`/`]` hint) or promote to a
  togglable side panel? A side panel competes with the future diagnostics panel (#100).
- With catalogs growing, `tab`-only cycling is O(n). Want grouped jumps, a search/
  filter, or digit shortcuts? (Digits 1–6 are already taken by tool selection, `:1143`
  area — watch the collision.)
- Does Eyedropper (`i`) already cover "select what's under the cursor"? Lean on it more?

---

## Problem 2 — Placement origin should be the sprite center, not the top-left (0,0)

**Symptom:** placing an entity uses the cursor as the box's **top-left**; author
expects the cursor to be the entity's **center**, so it lands offset down-right of
where they aimed.

**Current behavior:** `stampAt`→`place` stamps the glyph at the cursor cell, which is
the box's top-left anchor (ADR 0008). `footprintBox`/`groundSnap`/the ghost all anchor
top-left, so the 5×5 ghost extends down+right of the cursor.

**Desired:** position by the **visual center** of the sprite. Cursor at the center;
the editor computes the stored top-left glyph by offsetting `-floor(w/2), -floor(h/2)`.

**Key constraint — do NOT change the file format or engine.** The grid glyph must stay
the top-left anchor (`parseZone`, the runtime, the validator all assume it). This is an
**editor-only cursor↔anchor mapping**: render the ghost centered on the cursor, but
`place()` the glyph at `center - halfBox`. One conversion function used by ghost render,
`stampAt`, ground-snap, and erase hit-test keeps everything consistent.

**Design questions for the grill:**
- Half-offset rounding: `floor(w/2)` for a 5×5 = (2,2). Confirm the visual sprite is
  ~centered in its 5×5/4×5/4×7 logical box, else the "center" still looks off (the
  visual sprite is ~7×5 and decoupled from the box per ADR 0003 — verify against
  `drawEntitySprite`).
- Does center-origin interact with ground-snap? Snap currently seats the **box bottom**
  on ground; with center-origin the cursor would sit ~2 cells above the surface. Fine,
  but confirm the mental model (cursor = center, feet auto-find ground).
- This is the lever that fixes the "feels offset" complaint *and* simplifies Problem 4
  (hit-testing a footprint centered on the cursor is intuitive).

---

## Problem 3 — Entity placement should be click → drag → release, not click-to-spam

**Symptom:** clicking (or click-drag) with an entity Brush stamps **immediately and
repeatedly**, spamming duplicate entities along the drag path.

**Current behavior:** `onMouseDown` (button 0) → `toolPrimary` → `stampAt` places at
once (`:1019`, `:940`). `onMouseDrag` for the Brush calls `stampAt` **every cell**
(`:1035`) — designed for terrain drag-paint, but entities should never continuous-paint.

**Desired:** for **entity** Placeables, a single drag-and-drop:
`mousedown` picks up a ghost → `drag` repositions the ghost (ground-snapped live) →
`mouseup` commits **one** placement. Keyboard parity: `space` to pick up / `space` to
drop (or place-at-cursor in one press, matching the rect/line two-press anchor model in
`commitGesture`). Terrain Brush keeps its continuous drag-paint.

**Design questions for the grill:**
- Split behavior by Placeable kind (terrain = drag-paint, entity = drag-place) inside
  the Brush, or introduce a distinct **Place/Stamp tool** for entities and keep Brush
  terrain-only? (#91 point 7 says "Terrain drag-paints, entities click-place" — this
  problem argues click-place should be drag-place.)
- Reuse the existing anchor/`commitGesture` machinery (rect/line/select already do
  down=anchor / up=commit, `:1046`) so keyboard + mouse stay on one path?
- Should a placed entity then be **re-grabbable** to reposition (overlaps #97's "move
  via Select" and edit-on-click)? Decide the boundary with #97 so they don't collide.

---

## Problem 4 — Eraser should hit anywhere on the entity, not just its (invisible) origin

**Symptom:** Eraser only removes an entity when you click its **glyph origin cell**,
which isn't visually distinguishable from the rest of the sprite — clicking the body
does nothing.

**Current behavior:** `eraseAt`→`erase(doc, x, y)` (`placeable.ts:156`) clears the
**exact** cell. The glyph lives only at the top-left origin; the rest of the 5×5
footprint is empty grid cells, so a click there erases nothing.

**Desired:** clicking **any cell within an entity's footprint** removes that entity.

**Implementation sketch:** reverse-lookup — given a clicked cell `(x,y)`, find an entity
glyph whose `footprintBox` covers `(x,y)`, then erase at that glyph's origin. Because
entities store only the origin, scan candidate origin cells in the box-sized
neighborhood up-left of the click (`x-w+1..x`, `y-h+1..y`), resolve each via
`placeableAt`, and pick the one whose footprint contains the click (nearest origin wins
on overlap). This is a new pure helper (`entityAt(doc, x, y)` →
`{originX, originY, placeable} | undefined`) — unit-testable, and reused by the ghost,
move, and edit-on-click (#97) surfaces.

**Design questions for the grill:**
- Overlap resolution when two footprints cover the same cell (entities can be placed
  close together) — topmost? nearest origin? last-placed?
- Should Select/move (#97) and edit-on-click use the same `entityAt` footprint
  hit-test? (Strongly yes — one hit-test seam.)
- Does center-origin (Problem 2) make this trivial (footprint is centered on the
  cursor, so the click→origin math is symmetric)? Sequence #2 before #4.

---

## Cross-cutting notes & suggested sequencing

- **Problems 2 and 4 share one new concept: a footprint ⇄ cell mapping.** Land Problem 2
  (center-origin cursor↔anchor conversion) first; Problem 4's `entityAt` hit-test then
  falls out of the same geometry. Problem 3 (drag-place) reuses `entityAt` for
  re-grabbing and the existing `commitGesture` anchor path.
- **Invariant to preserve:** the stored grid glyph stays the **top-left** anchor (ADR
  0008) — all four are editor-side interaction changes, **zero** file-format / engine /
  validator change. The `placementState`/`groundSnap`/`footprintBox` pure seam from #96
  is the foundation; extend it, don't fork it.
- **Tests:** new pure helpers (center↔anchor conversion, `entityAt`) get
  `editor.test.ts` RED→GREEN coverage; the mouse/render changes are eyeball-only per the
  PRD (HITL sign-off in a real terminal).
- **Filing:** consider one tracking issue under #91 ("zone-editor: placement & erase
  interaction polish") with these four as a checklist, or two issues
  (origin+gesture / palette+erase). Decide in the grill.

## Open questions to settle before coding

1. Center-origin: editor-only remap (recommended) vs. anything deeper? Confirm visual
   sprite centering vs. the logical box.
2. Drag-place: extend Brush by kind, or a separate Place tool? Re-grab placed entities
   now or defer to #97?
3. Palette: inline bar polish vs. a side panel; how selection scales with catalog size.
4. Erase/move overlap resolution rule; unify the footprint hit-test across erase, move
   (#97), and edit-on-click (#97).
