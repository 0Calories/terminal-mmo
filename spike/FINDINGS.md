# M0 spike findings — OpenTUI go/no-go

**Verdict: GO ✅** — OpenTUI (`@opentui/core` 0.4.1, Zig core via Bun FFI) handles
our rendering needs with enormous headroom.

## What the spike proves

- A **scrolling camera** follows a controllable ~5×7 ASCII **Sprite** over a
  multi-screen **Terrain** (240×40 cell world).
- **Many multi-row sprites** move simultaneously with transparency (spaces let
  terrain show through) and overlap (avatars pass through each other, z-ordered by
  y, player on top) — exactly the ADR 0003 model.
- Imperative API is sufficient: `createCliRenderer` + `setFrameCallback` +
  `addPostProcessFn(buffer)` + `OptimizedBuffer.setCell/drawText/fillRect`, with
  `keyInput` (`keypress`/`keyrelease`) for input.

## Headless bench (compositor + JS draw loop, 120×40, 120 frames/sample)

| entities | avg ms/frame | approx fps |
|---------:|-------------:|-----------:|
|       50 |        0.21  |      ~4900 |
|      100 |        0.18  |      ~5700 |
|      200 |        0.24  |      ~4300 |
|      400 |        0.35  |      ~2900 |
|      800 |        0.61  |      ~1600 |

Sub-millisecond per frame at 800 entities — the compositor and draw loop are far
from the bottleneck and scale gracefully.

## Honest caveat

Headless timing (via `@opentui/core/testing` `renderOnce`) **excludes writing
escape codes to a real terminal and the emulator's repaint** — in a real TTY that
flush is the dominant cost and depends on the terminal emulator, viewport size,
and per-frame diff. So real-terminal fps will be well below the numbers above. But
those numbers show our own code leaves essentially the entire frame budget to the
terminal, which is the thing we couldn't have assumed. A ~120×40 viewport at 30–60
fps is comfortable for modern emulators.

**The remaining check requires a human in a real terminal:** run
`cd spike && bun run index.ts` and confirm scrolling/jumping feel smooth and input
is responsive. (Recommended terminals for best input: anything with Kitty keyboard
protocol — Ghostty, Kitty, WezTerm — which gives true key-release for held movement.)

### Input gotcha (carry into M1)

Continuous held movement requires `createCliRenderer({ useKittyKeyboard: { events: true } })`.
Kitty's `events` flag (press/repeat/**release**) defaults to **false**, so without it
no key-release events fire and held movement degrades to bursty OS auto-repeat. With
it on (Ghostty/Kitty/WezTerm), trust keyrelease and skip any timeout-based
"key up" fallback; keep the timeout only for terminals that never send releases.

## Files

- `game.ts` — throwaway game logic (world, physics, entities, draw)
- `index.ts` — interactive runner (`bun run index.ts` in a real terminal)
- `selftest.ts` — headless bench (`bun run selftest.ts`, CI-safe)
- `capture.ts` — prints one frame as text for eyeballing

This whole `spike/` folder is disposable — M1 builds the real `client`/`server`/
`shared` monorepo. The spike's only job was to de-risk the rendering bet, and it did.
