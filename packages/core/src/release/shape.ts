import { classifyPath } from './manifest';

export type ReleaseShape = 'both' | 'server' | 'client' | 'none';

export function releaseShape(changedPaths: Iterable<string>): ReleaseShape {
	let server = false;
	let client = false;
	for (const path of changedPaths) {
		switch (classifyPath(path) ?? 'contract') {
			case 'contract':
				return 'both';
			case 'server-only':
				server = true;
				break;
			case 'client-only':
				client = true;
				break;
			case 'neither':
				break;
		}
	}
	if (server && client) return 'both';
	if (server) return 'server';
	if (client) return 'client';
	return 'none';
}
