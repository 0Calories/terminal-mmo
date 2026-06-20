// Visual sprites (ADR 0003): decorative multi-row ASCII art, decoupled from the
// logical BOX. ~7 wide x 5 tall. Spaces are transparent when drawn.
import type { EntityType, Facing } from "@mmo/shared"

export const SPRITE_W = 7
export const SPRITE_H = 5

const PLAYER = ["  ___  ", " /o o\\ ", "( -.- )", " \\___/ ", " /   \\ "]
const CHASER = [" ,---. ", " |x x| ", "( >w< )", " `-v-' ", " /   \\ "]

const MIRROR: Record<string, string> = {
  "(": ")",
  ")": "(",
  "[": "]",
  "]": "[",
  "{": "}",
  "}": "{",
  "<": ">",
  ">": "<",
  "/": "\\",
  "\\": "/",
  "`": "'",
  "'": "`",
}
function mirror(rows: string[]): string[] {
  return rows.map((r) => {
    let out = ""
    for (let i = r.length - 1; i >= 0; i--) out += MIRROR[r[i]] ?? r[i]
    return out
  })
}

const ART: Record<EntityType, { 1: string[]; "-1": string[] }> = {
  player: { 1: PLAYER, "-1": mirror(PLAYER) },
  chaser: { 1: CHASER, "-1": mirror(CHASER) },
  shooter: { 1: CHASER, "-1": mirror(CHASER) }, // TODO(M1): distinct shooter art (#4)
}

export function spriteFor(type: EntityType, facing: Facing): string[] {
  return ART[type][facing === 1 ? 1 : "-1"]
}
