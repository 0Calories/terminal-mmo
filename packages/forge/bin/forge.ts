#!/usr/bin/env bun
import { join } from 'node:path';
import { run } from '../src/cli';
import { runEdit } from '../src/editor';
import { runPlay } from '../src/play';
import { runPreview } from '../src/preview';

// File I/O lives in the tooling layer (ADR 0008): Zones are read from the
// repo-root `zones/` dir and handed as strings to the pure parser/validators.
const root = join(process.cwd(), 'zones');
const deps = { root, log: (l: string) => console.log(l) };

// `forge` is the content-authoring suite: one CLI dispatching per content type.
// `zone` is the first domain; `sprite`, `npc`, `quest` slot in alongside it.
const [domain, ...rest] = process.argv.slice(2);

if (domain === 'zone') {
	// `preview`/`play`/`edit` are interactive + long-lived (mount opentui), so they run
	// the async shell; the rest are synchronous and return an exit code.
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
