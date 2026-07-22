import type { Box } from './types';

export interface Npc extends Box {
	id: number;
	kind: 'vendor';
	name: string;
}
