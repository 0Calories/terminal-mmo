// Dev aid: render one frame headlessly and print it as text, to eyeball that the
// camera/terrain/sprites compose correctly.
import { createTestRenderer } from "@opentui/core/testing"
import { Game } from "./game"

const game = new Game(24)
const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({ width: 90, height: 28 })
renderer.addPostProcessFn((buf) => game.draw(buf))

// walk right + a couple jumps so the camera leaves the origin
for (let i = 0; i < 60; i++) {
  game.input.right = true
  game.input.jump = i % 18 === 0
  game.update(16.6)
  await renderOnce()
}
console.log(captureCharFrame())
process.exit(0)
