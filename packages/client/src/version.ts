// The publish pipeline bakes MMO_VERSION via bun build --define; from-source leaves it unset → dev.
import { DEV_VERSION } from '@mmo/shared';

export const CLIENT_VERSION = process.env.MMO_VERSION ?? DEV_VERSION;
