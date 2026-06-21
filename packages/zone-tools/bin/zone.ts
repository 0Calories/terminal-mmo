#!/usr/bin/env bun
import { join } from 'node:path';
import { run } from '../src/cli';

// File I/O lives in the tooling layer (ADR 0008): Zones are read from the
// repo-root `zones/` dir and handed as strings to the pure parser/validators.
const root = join(process.cwd(), 'zones');
process.exit(run(process.argv.slice(2), { root, log: (l) => console.log(l) }));
