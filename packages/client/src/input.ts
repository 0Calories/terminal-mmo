import type { Input } from "@mmo/shared"

// Maps held keys into a per-tick Input. With Kitty key-release reporting we trust
// release events; on terminals without it we time out held keys (the M0 finding).
const HELD_MS = 220

type Action = "left" | "right" | "jump" | "attack"

function actionFor(name: string): Action | null {
  switch (name) {
    case "left": case "a": return "left"
    case "right": case "d": return "right"
    case "up": case "space": return "jump"
    case "j": case "x": return "attack"
    default: return null
  }
}

export class InputState {
  private held = new Set<Action>()
  private seen = new Map<Action, number>()
  private releaseCapable = false

  press(name: string, now: number) {
    const a = actionFor(name)
    if (!a) return
    this.held.add(a)
    this.seen.set(a, now)
  }

  release(name: string) {
    this.releaseCapable = true // terminal reports releases — drop timeout fallback
    const a = actionFor(name)
    if (a) this.held.delete(a)
  }

  poll(now: number): Input {
    if (!this.releaseCapable) {
      for (const a of [...this.held])
        if (now - (this.seen.get(a) ?? 0) > HELD_MS) this.held.delete(a)
    }
    const moveX = (this.held.has("right") ? 1 : 0) - (this.held.has("left") ? 1 : 0)
    return {
      moveX: moveX as -1 | 0 | 1,
      jump: this.held.has("jump"),
      attack: this.held.has("attack"),
    }
  }
}
