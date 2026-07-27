export type PathKind = 'contract' | 'server-only' | 'client-only' | 'neither';

const EXACT: Readonly<Record<string, PathKind>> = {
	'.dependency-cruiser.cjs': 'neither',
	'.dockerignore': 'server-only',
	'.gitignore': 'neither',
	'AGENTS.md': 'neither',
	'CLAUDE.md': 'neither',
	'CONTEXT.md': 'neither',
	'CONTRIBUTING.md': 'neither',
	'README.md': 'neither',
	'biome.json': 'neither',
	'build-info.json': 'neither',
	'bun.lock': 'contract',
	'bunfig.toml': 'neither',
	Dockerfile: 'server-only',
	'package.json': 'contract',
	'packages/core/tsconfig.tsbuildinfo': 'neither',
	'railway.json': 'server-only',
	'tsconfig.base.json': 'neither',
};

const PREFIX: readonly (readonly [string, PathKind])[] = [
	['.github/', 'neither'],
	['docs/', 'neither'],
	['packages/assets/', 'contract'],
	['packages/cli/', 'client-only'],
	['packages/client/', 'client-only'],
	['packages/core/', 'contract'],
	['packages/forge/', 'neither'],
	['packages/render/', 'client-only'],
	['packages/server/', 'server-only'],
	['scripts/', 'neither'],
	['sprites/', 'client-only'],
	['zones/', 'contract'],
];

// The directories and files a contract-hash computation must read: every
// contract-classified root plus sprites/ (client-only bodies, but the id sets
// feed the hash). Derived from the manifest so the walk can never drift from
// the classification.
export function contractRoots(): {
	prefixes: readonly string[];
	files: readonly string[];
} {
	const prefixes = PREFIX.filter(([, kind]) => kind === 'contract').map(
		([prefix]) => prefix,
	);
	if (!prefixes.includes('sprites/')) prefixes.push('sprites/');
	const files = Object.entries(EXACT)
		.filter(([, kind]) => kind === 'contract')
		.map(([path]) => path);
	return { prefixes, files };
}

export function classifyPath(path: string): PathKind | undefined {
	const exact = EXACT[path];
	if (exact) return exact;
	for (const [prefix, kind] of PREFIX) {
		if (path.startsWith(prefix)) return kind;
	}
	return undefined;
}
