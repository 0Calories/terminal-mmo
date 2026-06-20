// M0 spike — interactive runner. Run in a real terminal: `bun run index.ts`
import { createCliRenderer } from "@opentui/core"
import { Game } from "./game"

const renderer = await createCliRenderer({
  targetFps: 60,
  exitOnCtrlC: true,
  backgroundColor: "#10121a",
  // Ghostty/Kitty/WezTerm: report press/repeat/RELEASE so we get continuous
  // held movement instead of relying on the OS auto-repeat (which is bursty).
  useKittyKeyboard: { events: true },
})

const game = new Game(80)

// Held-key tracking. With release reporting (above), a key stays "down" from
// keypress until keyrelease — continuous movement. On terminals that DON'T report
// releases we fall back to a repeat-refreshed timeout (bursty but functional).
const HELD_MS = 220
const seen = { left: 0, right: 0, jump: 0 }
let releaseCapable = false
type Dir = keyof typeof seen
const keyToDir = (name: string): Dir | null =>
  name === "left" || name === "a" ? "left"
  : name === "right" || name === "d" ? "right"
  : name === "up" || name === "space" ? "jump"
  : null

renderer.keyInput.on("keypress", (k) => {
  const name = k.name
  if (name === "q") { try { (renderer as any).destroy?.() } catch {} process.exit(0) }
  if (name === "]") { game.addEntities(20); return }
  if (name === "[") { game.removeEntities(20); return }
  const dir = keyToDir(name)
  if (dir) { seen[dir] = performance.now(); game.input[dir] = true }
})
renderer.keyInput.on("keyrelease", (k) => {
  releaseCapable = true // terminal reports releases — drop the timeout fallback
  const dir = keyToDir(k.name)
  if (dir) { game.input[dir] = false; seen[dir] = 0 }
})

renderer.setFrameCallback(async (dt) => {
  if (!releaseCapable) {
    const now = performance.now()
    for (const d of ["left", "right", "jump"] as Dir[])
      if (game.input[d] && now - seen[d] > HELD_MS) game.input[d] = false
  }
  game.update(dt)
})
renderer.addPostProcessFn((buf) => game.draw(buf))
renderer.start()
