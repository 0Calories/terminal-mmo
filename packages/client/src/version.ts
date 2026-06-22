// This client's release Version (ADR 0012), carried on `hello` and matched by the
// deployed server. The publish pipeline bakes the git tag into the bundle via
// `bun build --define process.env.MMO_VERSION` (see packages/cli/build.ts), so the
// published binary always reports its own build's Version regardless of the user's
// environment. Running from source in local dev leaves it unset → `dev`, which a
// dev server accepts and a deployed server rejects.
import { DEV_VERSION } from '@mmo/shared';

export const CLIENT_VERSION = process.env.MMO_VERSION ?? DEV_VERSION;
