#!/usr/bin/env bun
import { join } from 'node:path';
import { run } from '../src/cli';
import { runEdit } from '../src/editor';
import { runPlay } from '../src/play';
import { runPreview } from '../src/preview';

const root = join(process.cwd(), 'zones');
const deps = { root, log: (l: string) => console.log(l) };

const [domain, ...rest] = process.argv.slice(2);

if (domain === 'zone') {
	if (rest[0] === 'preview') await runPreview(rest.slice(1), deps);
	else if (rest[0] === 'play') await runPlay(rest.slice(1), deps);
	else if (rest[0] === 'edit') await runEdit(rest.slice(1), deps);
	else process.exit(run(rest, deps));
} else {
	console.log(
		[
			'usage: forge <domain> <command>',
			'',
			'  zone   author + validate .zone content (render|preview|play|edit|check|new|rename)',
			'',
			'run `forge zone` for zone subcommands.',
		].join('\n'),
	);
	process.exit(domain ? 1 : 0);
}
