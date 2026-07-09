#!/usr/bin/env bun
import { join } from 'node:path';
import { run } from '../src/cli';
import { runEdit } from '../src/editor';
import { runPlay } from '../src/play';
import { runPreview } from '../src/preview';
import { runSprite } from '../src/sprite-cli';

const root = join(process.cwd(), 'zones');
const deps = { root, log: (l: string) => console.log(l) };

const [domain, ...rest] = process.argv.slice(2);

if (domain === 'zone') {
	if (rest[0] === 'preview') await runPreview(rest.slice(1), deps);
	else if (rest[0] === 'play') await runPlay(rest.slice(1), deps);
	else if (rest[0] === 'edit') await runEdit(rest.slice(1), deps);
	else process.exit(run(rest, deps));
} else if (domain === 'sprite') {
	process.exit(
		runSprite(rest, {
			root: join(process.cwd(), 'sprites'),
			log: (l: string) => console.log(l),
		}),
	);
} else {
	console.log(
		[
			'usage: forge <domain> <command>',
			'',
			'  zone     author + validate .zone content (render|preview|play|edit|check|new|rename)',
			'  sprite   author + validate .sprite art (render)',
			'',
			'run `forge zone` for zone subcommands.',
			'run `forge sprite` for sprite subcommands.',
		].join('\n'),
	);
	process.exit(domain ? 1 : 0);
}
