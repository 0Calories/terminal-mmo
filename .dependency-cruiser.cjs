/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
	forbidden: [
		{
			name: 'server-no-render',
			comment:
				'The server simulates but never draws: it must not depend on @mmo/render ' +
				'(ADR 0030). Presentation is provably unreachable from the sim — the build ' +
				'graph enforces it (server does not list @mmo/render), and this rule backstops ' +
				'it against someone adding the dependency by hand.',
			severity: 'error',
			from: { path: '^packages/server' },
			to: { path: '(^packages/render|^@mmo/render$)' },
		},
		{
			name: 'server-assets-meta-only',
			comment:
				'The server may see asset identity (ids/roles/zone-list) but never sprite ' +
				'sources: it imports @mmo/assets/meta only, never the full door (ADR 0033). ' +
				'Art data stays inert text behind /meta; art code stays in @mmo/render.',
			severity: 'error',
			from: { path: '^packages/server' },
			to: {
				path: '^packages/assets',
				pathNot: '^packages/assets/src/meta\\.ts$',
			},
		},
		{
			name: 'assets-no-render',
			comment:
				'@mmo/assets holds inert asset text (+ parsed zones via core); it must not ' +
				'reach @mmo/render, or sprite code would become reachable from the server ' +
				'through the /meta door (ADR 0030/0033).',
			severity: 'error',
			from: { path: '^packages/assets' },
			to: { path: '(^packages/render|^@mmo/render$)' },
		},
	],
	options: {
		tsConfig: { fileName: 'tsconfig.base.json' },
		tsPreCompilationDeps: true,
		doNotFollow: { path: 'node_modules' },
		enhancedResolveOptions: {
			exportsFields: ['exports'],
			conditionNames: ['import', 'require', 'node', 'default', 'types'],
		},
	},
};
