// This client's release Version (ADR 0012), carried on `hello` and matched by the server.
// The publish pipeline bakes the git tag in via `bun build --define process.env.MMO_VERSION`
// (packages/cli/build.ts); running from source leaves it unset → `dev`, which deployed
// servers reject.
import { DEV_VERSION } from '@mmo/shared';

export const CLIENT_VERSION = process.env.MMO_VERSION ?? DEV_VERSION;
