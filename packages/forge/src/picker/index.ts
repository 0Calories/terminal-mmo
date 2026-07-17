// Curated barrel for the picker module (ADR 0032: a module is a directory
// entered through its curated barrel). The launcher entry point is the whole
// public surface; the model is internal, tested white-box via deep imports.
export { runPicker } from './tui';
