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
const argv = process.argv.slice(2);

// `preview` and `play` are interactive + long-lived (mount opentui), so they run
// the async shell and let opentui own the process lifecycle. The other commands
// are synchronous and return an exit code.
if (argv[0] === 'preview') await runPreview(argv.slice(1), deps);
else if (argv[0] === 'play') await runPlay(argv.slice(1), deps);
else if (argv[0] === 'edit') await runEdit(argv.slice(1), deps);
else process.exit(run(argv, deps));
