// Curated barrel for the sprite-editor module (ADR 0032: a module is a
// directory entered through its curated barrel). Only what outsiders actually
// consume is exported; everything else in this directory is internal wiring
// between the editor's own files (state/view/input/strips/…), and tests reach
// internals white-box via deep imports on purpose.
export { RAIL_TOOLS, TOOL_GLYPH_FALLBACKS } from './chrome';
export {
	previewStances,
	renderComposite,
	styleWithLocalColors,
} from './composite';
export { runSpriteEdit } from './tui';
export { roleForDir } from './view';
