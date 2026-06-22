// The Sprite class, art, and entity→sprite registry now live in @mmo/shared so
// both the game and the forge preview render from one source. This barrel
// keeps only the client-side art PALETTE (keyed colours are opentui RGBA).
export { PALETTE } from './palette';
