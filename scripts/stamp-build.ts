import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { computeContractHash } from '../packages/assets/src/index.ts';
import { makeStamp } from '../packages/core/src/release/index.ts';

const root = join(import.meta.dir, '..');

const proc = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: root });
if (proc.exitCode !== 0) {
	console.error('stamp: git rev-parse HEAD failed');
	process.exit(1);
}
const gitSha = proc.stdout.toString().trim();

const args = process.argv.slice(2);
const versionFlag = args.indexOf('--version');
const version =
	versionFlag >= 0 && args[versionFlag + 1]
		? args[versionFlag + 1]
		: `dev-${gitSha.slice(0, 7)}`;

const stamp = makeStamp({
	version,
	gitSha,
	contractHash: computeContractHash(root),
});

const path = join(root, 'build-info.json');
writeFileSync(path, `${JSON.stringify(stamp, null, '\t')}\n`);
console.log(
	`stamped ${path}: version ${stamp.version}, git ${gitSha.slice(0, 12)}, contract ${stamp.contractHash.slice(0, 12)}`,
);
