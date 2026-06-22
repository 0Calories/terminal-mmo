#!/usr/bin/env bun
import { join } from 'node:path';
import { run } from '../src/cli';
import { runPreview } from '../src/preview';

// File I/O lives in the tooling layer (ADR 0008): Zones are read from the
// repo-root `zones/` dir and handed as strings to the pure parser/validators.
const root = join(process.cwd(), 'zones');
const deps = { root, log: (l: string) => console.log(l) };
const argv = process.argv.slice(2);

// `preview` is interactive + long-lived (mounts opentui, watches the file), so
// it runs the async shell and lets opentui own the process lifecycle. The other
// commands are synchronous and return an exit code.
if (argv[0] === 'preview') await runPreview(argv.slice(1), deps);
else process.exit(run(argv, deps));
