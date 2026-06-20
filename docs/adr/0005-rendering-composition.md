---
status: accepted
---

# Rendering composition: imperative playfield + retained UI, no React game engine

The client (`packages/client`) currently uses only OpenTUI's lowest-level API: a
single `addPostProcessFn` hand-paints every cell each frame — terrain, Sprites,
combat telegraphs, **and** the HUD/log/hint text — into one `OptimizedBuffer`,
with manual camera math and manual `x/y` text placement. OpenTUI is being treated
as a framebuffer; layout, widgets, and focus are reimplemented by hand. This ADR
sets the boundary for how we compose rendering as the client grows past the M1
spike into menus, inventory, chat, vendors, and character creation.

The central constraint: a 60 fps scrolling platformer is **immediate-mode** — the
camera moves and nearly every cell changes every frame, so the playfield is fully
redrawn each tick. React (and any retained scene graph) is **retained-mode** — it
pays off when UI is a function of state that changes on *discrete events*. The
mistake to avoid is putting a virtual-DOM diff in front of a buffer that is fully
invalidated 60×/sec.

OpenTUI exposes three tiers, all usable simultaneously on one renderer: (1) raw
`OptimizedBuffer` drawing, (2) the `Renderable` scene graph with Yoga flexbox
layout and ready-made widgets, (3) the `@opentui/react` reconciler
(`createRoot(renderer).render(<App/>)`, `<box>/<text>/<select>`, `useKeyboard`,
`useTimeline`).

## Decisions

- **Split rendering by update frequency, not by feature.** The hot, per-frame
  playfield stays imperative; the event-driven chrome moves to retained UI. This
  is a hybrid, not a rewrite.
- **The playfield is one custom `Renderable`.** Today's `draw()` body becomes
  `renderSelf(buffer)` on a `PlayfieldRenderable` mounted in the scene graph,
  marked `live` so it drives continuous frames. It keeps 100% of the imperative
  cell-drawing performance but becomes a positioned, sized *node* (behind a HUD,
  swappable for a menu) instead of a global post-process hook. This is the
  r3f-style escape hatch; `extend({ playfield: PlayfieldRenderable })` later
  exposes it as `<playfield>` if the chrome adopts React.
- **Chrome is built from renderables/React, not hand-painted.** HUD, inventory,
  chat log + whisper input, emote menu, vendor list, character creation, the
  SSH-key login screen, and level-up toasts use Yoga layout and OpenTUI's
  widgets (`SelectRenderable`, `InputRenderable`, `ScrollBoxRenderable`,
  `ASCIIFontRenderable`, `TabSelectRenderable`) instead of manual `x/y` math.
- **`@opentui/react` is adopted incrementally for new chrome only**, as the
  milestones that need it land — never for the playfield. The playfield is
  updated each tick via a ref; React re-renders HUD/menus only when
  level/HP/inventory/etc. change.
- **No React game-engine library, and the simulation never enters a render
  cycle.** All sim logic stays in `@mmo/shared` as pure deterministic functions
  (per ADR 0002); rendering/UI is the only thing OpenTUI's tiers touch.

## Considered and rejected

- **Full React rewrite (playfield included).** Reconciling a tree of thousands
  of cells that all change every frame is strictly worse than the current
  imperative draw. Rejected: wrong mode for a 60 fps scroller.
- **Stay fully imperative (status quo).** Keeps one mental model but forces us to
  hand-build flexbox layout, list/scroll/input/focus widgets, and text placement
  for all future chrome — exactly the work OpenTUI already ships. Rejected as
  false economy now that chrome is imminent.
- **A React game-engine library (`react-game-engine`, `react-native-game-engine`,
  `@react-three/fiber`, `@pixi/react`).** Every shipping option is bound to
  react-dom, React Native, or WebGL — none target OpenTUI's terminal reconciler,
  so none mount. More fundamentally, an ECS-in-React loop would pull the
  simulation into React's render cycle and into the client only, breaking the
  ADR 0002 invariant that the **M2 server (no React)** runs the identical
  `step()`. If we want ECS structure it belongs in `shared`, framework-free.
  Rejected on both compatibility and architecture.

## Consequences

- `render.ts` is refactored into a `PlayfieldRenderable` (mechanical, no perf
  change, no React) — the prerequisite step. HUD/log/hint then lift out of the
  playfield into layout-driven renderables, deleting the manual placement math.
- A second rendering model (retained UI) enters the client. The seam is explicit:
  imperative inside `renderSelf`, retained everywhere else. Contributors must
  know which side of the seam they are on.
- Adopting React adds `react` / `react-reconciler` / `scheduler` deps to the
  client only. `shared` and `server` stay framework-free; the
  client/server-shared `step()` is untouched.
- M0/M1 is the cheapest time to set this boundary; deferring it means more
  hand-painted chrome to unwind later.
- OpenTUI immaturity risk (ADR 0002) now also covers the React reconciler and
  widget set; mitigated by their being confined to non-hot chrome that degrades
  gracefully and by prior in-house use of `@opentui/react`.
</content>
</invoke>
