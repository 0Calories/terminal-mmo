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
