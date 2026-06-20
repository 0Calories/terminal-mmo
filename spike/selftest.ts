// M0 spike — headless self-test. Runs without a TTY (CI/sandbox-safe) using
// OpenTUI's test renderer. Measures compositor + draw cost at increasing entity
// counts and verifies a frame actually renders Terrain + Sprites.
//
// NOTE: headless timing excludes writing escape codes to a real terminal, so it
// is an optimistic upper bound — but it exercises the Zig compositor and the JS
// draw loop, which is exactly the part that scales with entity count. The true
// feel test is `bun run index.ts` in a real terminal.
import { createTestRenderer } from "@opentui/core/testing"
import { Game } from "./game"

const W = 120, H = 40
const FRAMES = 120
const counts = [50, 100, 200, 400, 800]

console.log(`headless render bench — ${W}x${H}, ${FRAMES} frames/sample\n`)
console.log("entities |  avg ms | approx fps")
console.log("---------+---------+-----------")

let okFrame = false
let fpsAt100 = 0

for (const target of counts) {
  const game = new Game(target - 1) // +1 for the player
  const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({ width: W, height: H })
  renderer.addPostProcessFn((buf) => game.draw(buf))

  // warm up
  for (let i = 0; i < 5; i++) { game.update(16.6); await renderOnce() }

  let total = 0
  for (let i = 0; i < FRAMES; i++) {
    game.input.right = i % 40 < 30 // scroll the camera around
    game.input.jump = i % 23 === 0
    game.update(16.6)
    const t0 = performance.now()
    await renderOnce()
    total += performance.now() - t0
  }
  const avg = total / FRAMES
  const fps = Math.round(1000 / avg)
  console.log(`${String(game.entityCount).padStart(8)} | ${avg.toFixed(2).padStart(7)} | ${String(fps).padStart(9)}`)

  if (target === 100) {
    fpsAt100 = fps
    const frame = captureCharFrame()
    okFrame = frame.includes("█") && /[\/o_\\()-]/.test(frame)
  }
  try { (renderer as any).destroy?.() } catch {}
}

console.log("\n--- verdict ---")
console.log(`frame content present (terrain + sprites): ${okFrame ? "YES" : "NO"}`)
console.log(`headless fps @100 entities: ${fpsAt100} (target >= 30)`)
const pass = okFrame && fpsAt100 >= 30
console.log(pass ? "RESULT: PASS ✅" : "RESULT: FAIL ❌")
process.exit(pass ? 0 : 1)
