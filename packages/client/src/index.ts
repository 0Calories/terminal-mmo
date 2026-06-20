// @mmo/client — runnable single-player core loop (M1). Run in a real terminal:
//   bun run dev   (from packages/client)  or   bun run dev:client  (from root)
//
// All game logic lives in @mmo/shared; this file only does I/O: render, input,
// and driving the deterministic `step` each frame.
import { createCliRenderer } from "@opentui/core"
import { createGame, step } from "@mmo/shared"
import { draw } from "./render"
import { InputState } from "./input"

const renderer = await createCliRenderer({
  targetFps: 60,
  exitOnCtrlC: true,
  backgroundColor: "#10121a",
  // Report press/repeat/RELEASE for continuous held movement (M0 finding).
  useKittyKeyboard: { events: true },
})

let game = createGame()
const input = new InputState()

renderer.keyInput.on("keypress", (k) => {
  if (k.name === "q") {
    try {
      ;(renderer as unknown as { destroy?: () => void }).destroy?.()
    } catch {}
    process.exit(0)
  }
  input.press(k.name, performance.now())
})
renderer.keyInput.on("keyrelease", (k) => input.release(k.name))

let fps = 0
let acc = 0
let frames = 0

renderer.setFrameCallback(async (dt) => {
  game = step(game, input.poll(performance.now()), dt)
  acc += dt
  frames++
  if (acc >= 500) {
    fps = Math.round((frames * 1000) / acc)
    acc = 0
    frames = 0
  }
})
renderer.addPostProcessFn((buf) => draw(buf, game, fps))
renderer.start()
