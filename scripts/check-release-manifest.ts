import { classifyPath } from '../packages/core/src/release/index.ts';

const proc = Bun.spawnSync(['git', 'ls-files'], {
	cwd: import.meta.dir + '/..',
});
if (proc.exitCode !== 0) {
	console.error('release manifest check: git ls-files failed');
	process.exit(1);
}

const tracked = proc.stdout.toString().trim().split('\n');
const unclassified = tracked.filter((path) => classifyPath(path) === undefined);

if (unclassified.length > 0) {
	console.error('release manifest check: these tracked paths match no rule in');
	console.error('packages/core/src/release/manifest.ts:');
	for (const path of unclassified) console.error(`  ${path}`);
	console.error(
		'Classify each as contract / server-only / client-only / neither.',
	);
	console.error('When in doubt, contract — ambiguity must fail safe.');
	process.exit(1);
}

console.log(
	`release manifest check: ${tracked.length} tracked paths classified`,
);
