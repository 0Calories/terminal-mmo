#!/usr/bin/env bun
import { join } from 'node:path';
import { run } from '../src/cli';
import { runEdit } from '../src/editor';
import { runPicker } from '../src/picker';
import { runPlay } from '../src/play';
import { runPreview } from '../src/preview';
import { runSprite } from '../src/sprite-cli';
import { runSpriteEdit, runSpritePreview } from '../src/sprite-editor';

const zonesRoot = join(process.cwd(), 'zones');
const spritesRoot = join(process.cwd(), 'sprites');
const log = (l: string) => console.log(l);
const deps = { root: zonesRoot, log };
const spriteDeps = { root: spritesRoot, log };
const pickerDeps = { spritesRoot, zonesRoot, log };

const [domain, ...rest] = process.argv.slice(2);

if (domain === 'zone') {
	if (rest[0] === 'preview') await runPreview(rest.slice(1), deps);
	else if (rest[0] === 'play') await runPlay(rest.slice(1), deps);
	// `forge zone edit` with a target edits it directly; with no target it opens
	// the unified picker pre-filtered to zones (spec #387).
	else if (rest[0] === 'edit')
		if (rest[1]) await runEdit(rest.slice(1), deps);
		else await runPicker('zone', pickerDeps);
	else process.exit(run(rest, deps));
} else if (domain === 'sprite') {
	if (rest[0] === 'edit')
		if (rest[1]) await runSpriteEdit(rest.slice(1), spriteDeps);
		else await runPicker('sprite', pickerDeps);
	else if (rest[0] === 'preview')
		await runSpritePreview(rest.slice(1), spriteDeps);
	else process.exit(runSprite(rest, spriteDeps));
} else if (!domain) {
	// Bare `forge`: the single entry point — the picker over every editable asset
	// (sprites grouped by role, zones as their own section) (spec #387).
	await runPicker(null, pickerDeps);
} else {
	log(
		[
			'usage: forge [<domain> <command>]',
			'',
			'  (no args) open the unified asset picker over all editable assets',
			'  zone      author + validate .zone content (render|preview|play|edit|check|new|rename)',
			'  sprite    author + validate .sprite art (render|check|edit|preview)',
			'',
			'run `forge zone` for zone subcommands.',
			'run `forge sprite` for sprite subcommands.',
		].join('\n'),
	);
	process.exit(1);
}
