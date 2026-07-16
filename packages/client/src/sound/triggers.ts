import type { Entity } from '@mmo/core/entities';

export function jumpStarted(
	prev: Pick<Entity, 'onGround'>,
	next: Pick<Entity, 'onGround' | 'vy'>,
): boolean {
	return prev.onGround && !next.onGround && next.vy < 0;
}

export function landed(
	prev: Pick<Entity, 'onGround'>,
	next: Pick<Entity, 'onGround'>,
): boolean {
	return !prev.onGround && next.onGround;
}

export function leveledUp(prevLevel: number, nextLevel: number): boolean {
	return nextLevel > prevLevel;
}
