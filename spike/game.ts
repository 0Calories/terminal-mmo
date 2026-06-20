// M0 spike — game logic for the OpenTUI go/no-go test.
// Goal: prove OpenTUI can scroll a camera over Terrain and move many ~5x7
// ASCII Sprites at 30+fps. Physics here is throwaway; the point is rendering.
import { RGBA } from "@opentui/core"
import type { OptimizedBuffer } from "@opentui/core"

// ---- world ----
const WORLD_W = 240
const WORLD_H = 40
const GROUND_TOP = WORLD_H - 3

// ---- sprite (5 rows x 7 cols, "Claude-mascot level" placeholder) ----
const SPRITE: string[] = [
  "  ___  ",
  " /o o\\ ",
  "( -.- )",
  " \\___/ ",
  " /   \\ ",
]
const SPRITE_W = 7
const SPRITE_H = 5
// logical collision box, deliberately smaller than the sprite (ADR 0003)
const BOX_W = 5
const BOX_H = 5
const SPRITE_OFFX = Math.floor((SPRITE_W - BOX_W) / 2)

// physics (cells/sec)
const SPEED = 22
const JUMP = 34
const GRAV = 90

const MIRROR: Record<string, string> = {
  "(": ")", ")": "(", "[": "]", "]": "[",
  "{": "}", "}": "{", "<": ">", ">": "<",
  "/": "\\", "\\": "/",
}
function mirrorRow(row: string): string {
  let out = ""
  for (let i = row.length - 1; i >= 0; i--) out += MIRROR[row[i]] ?? row[i]
  return out
}
const SPRITE_L = SPRITE.map(mirrorRow)

// deterministic RNG so the world + self-test are stable
function lcg(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff)
}

interface Entity {
  x: number; y: number; vx: number; vy: number
  facing: 1 | -1; onGround: boolean
  fg: RGBA
}

export class Game {
  world: Uint8Array // WORLD_W*WORLD_H, 1 = solid
  player: Entity
  others: Entity[] = []
  cam = { x: 0, y: 0 }
  input = { left: false, right: false, jump: false }
  // fps tracking
  private acc = 0
  private frames = 0
  fps = 0

  private bg = RGBA.fromInts(16, 18, 24, 255)
  private terrainFg = RGBA.fromInts(70, 82, 104, 255)
  private terrainBg = RGBA.fromInts(34, 40, 54, 255)
  private transparent = RGBA.fromInts(0, 0, 0, 0)
  private hudFg = RGBA.fromInts(230, 230, 235, 255)
  private hudBg = RGBA.fromInts(8, 9, 13, 255)

  constructor(entityCount = 80) {
    this.world = new Uint8Array(WORLD_W * WORLD_H)
    const rng = lcg(1337)
    // ground
    for (let y = GROUND_TOP; y < WORLD_H; y++)
      for (let x = 0; x < WORLD_W; x++) this.world[y * WORLD_W + x] = 1
    // scattered platforms
    for (let i = 0; i < 70; i++) {
      const px = Math.floor(rng() * (WORLD_W - 16)) + 2
      const py = GROUND_TOP - 4 - Math.floor(rng() * 18)
      const len = 6 + Math.floor(rng() * 12)
      for (let x = px; x < Math.min(px + len, WORLD_W); x++) this.world[py * WORLD_W + x] = 1
    }
    this.player = this.spawn(8, RGBA.fromInts(255, 150, 40, 255))
    for (let i = 0; i < entityCount; i++) this.addOther(rng)
  }

  private spawn(x: number, fg: RGBA): Entity {
    return { x, y: GROUND_TOP - BOX_H, vx: 0, vy: 0, facing: 1, onGround: false, fg }
  }
  private addOther(rng = lcg((this.others.length + 7) * 2654435761)) {
    const fg = RGBA.fromInts(
      120 + Math.floor(rng() * 135),
      120 + Math.floor(rng() * 135),
      120 + Math.floor(rng() * 135),
      255,
    )
    const e = this.spawn(4 + Math.floor(rng() * (WORLD_W - 12)), fg)
    e.vx = rng() < 0.5 ? -14 : 14
    e.facing = e.vx < 0 ? -1 : 1
    this.others.push(e)
  }
  addEntities(n: number) { for (let i = 0; i < n; i++) this.addOther() }
  removeEntities(n: number) { this.others.splice(0, Math.min(n, this.others.length)) }
  get entityCount() { return this.others.length + 1 }

  private solid(cx: number, cy: number): boolean {
    if (cx < 0 || cx >= WORLD_W) return true
    if (cy < 0) return false
    if (cy >= WORLD_H) return true
    return this.world[cy * WORLD_W + cx] === 1
  }

  // returns true if it bumped a wall horizontally
  private collide(e: Entity, dt: number): boolean {
    let hitWall = false
    e.x += e.vx * dt
    const top = Math.floor(e.y), bot = Math.ceil(e.y + BOX_H) - 1
    if (e.vx > 0) {
      const r = Math.ceil(e.x + BOX_W) - 1
      for (let cy = top; cy <= bot; cy++) if (this.solid(r, cy)) { e.x = r - BOX_W; e.vx = 0; hitWall = true; break }
    } else if (e.vx < 0) {
      const l = Math.floor(e.x)
      for (let cy = top; cy <= bot; cy++) if (this.solid(l, cy)) { e.x = l + 1; e.vx = 0; hitWall = true; break }
    }
    e.vy += GRAV * dt
    e.y += e.vy * dt
    const l = Math.floor(e.x), r = Math.ceil(e.x + BOX_W) - 1
    e.onGround = false
    if (e.vy > 0) {
      const feet = Math.ceil(e.y + BOX_H) - 1
      for (let cx = l; cx <= r; cx++) if (this.solid(cx, feet)) { e.y = feet - BOX_H; e.vy = 0; e.onGround = true; break }
    } else if (e.vy < 0) {
      const head = Math.floor(e.y)
      for (let cx = l; cx <= r; cx++) if (this.solid(cx, head)) { e.y = head + 1; e.vy = 0; break }
    }
    return hitWall
  }

  update(dtMs: number) {
    const dt = Math.min(dtMs / 1000, 0.05)
    // player
    const p = this.player
    p.vx = (this.input.right ? SPEED : 0) - (this.input.left ? SPEED : 0)
    if (p.vx > 0) p.facing = 1; else if (p.vx < 0) p.facing = -1
    if (this.input.jump && p.onGround) { p.vy = -JUMP; p.onGround = false }
    this.collide(p, dt)
    // others: patrol, flip at walls and platform edges
    for (const e of this.others) {
      const wall = this.collide(e, dt)
      if (e.onGround) {
        const lead = e.vx >= 0 ? Math.ceil(e.x + BOX_W) - 1 : Math.floor(e.x)
        const footY = Math.ceil(e.y + BOX_H)
        if (wall || !this.solid(lead, footY)) { e.vx = -(e.vx || 14); e.facing = e.vx < 0 ? -1 : 1 }
      }
    }
    // fps
    this.acc += dtMs; this.frames++
    if (this.acc >= 500) { this.fps = Math.round((this.frames * 1000) / this.acc); this.acc = 0; this.frames = 0 }
  }

  private drawSprite(buf: OptimizedBuffer, e: Entity, sw: number, sh: number) {
    const art = e.facing === 1 ? SPRITE : SPRITE_L
    const sx = Math.round(e.x - SPRITE_OFFX - this.cam.x)
    const sy = Math.round(e.y - this.cam.y)
    for (let ry = 0; ry < SPRITE_H; ry++) {
      const py = sy + ry
      if (py < 1 || py >= sh) continue // row 0 reserved for HUD
      const row = art[ry]
      for (let rx = 0; rx < SPRITE_W; rx++) {
        const ch = row[rx]
        if (ch === " ") continue // transparent
        const px = sx + rx
        if (px < 0 || px >= sw) continue
        buf.setCellWithAlphaBlending(px, py, ch, e.fg, this.transparent)
      }
    }
  }

  draw(buf: OptimizedBuffer) {
    const sw = buf.width, sh = buf.height
    // camera clamp
    this.cam.x = Math.max(0, Math.min(Math.round(this.player.x + BOX_W / 2 - sw / 2), Math.max(0, WORLD_W - sw)))
    this.cam.y = Math.max(0, Math.min(Math.round(this.player.y + BOX_H / 2 - sh / 2), Math.max(0, WORLD_H - sh)))
    buf.clear(this.bg)
    // terrain (only visible cells)
    for (let sy = 1; sy < sh; sy++) {
      const wy = sy + this.cam.y
      for (let sx = 0; sx < sw; sx++) {
        const wx = sx + this.cam.x
        if (this.solid(wx, wy) && wx >= 0 && wx < WORLD_W && wy >= 0 && wy < WORLD_H)
          buf.setCell(sx, sy, "█", this.terrainFg, this.terrainBg)
      }
    }
    // entities, z-ordered by y (player drawn last = on top)
    const vis = this.others.filter((e) => {
      const sx = e.x - this.cam.x, sy = e.y - this.cam.y
      return sx > -SPRITE_W && sx < sw && sy > -SPRITE_H && sy < sh
    })
    vis.sort((a, b) => a.y - b.y)
    for (const e of vis) this.drawSprite(buf, e, sw, sh)
    this.drawSprite(buf, this.player, sw, sh)
    // HUD
    for (let x = 0; x < sw; x++) buf.setCell(x, 0, " ", this.hudFg, this.hudBg)
    const hud = ` FPS ${String(this.fps).padStart(3)} | entities ${this.entityCount} | move ←/→ a/d  jump ␣/↑  +/- entities [ ]  quit q `
    buf.drawText(hud.slice(0, sw), 0, 0, this.hudFg, this.hudBg)
  }
}
