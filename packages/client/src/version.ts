import { DEV_VERSION } from '@mmo/core/protocol';

export const CLIENT_VERSION = process.env.MMO_VERSION ?? DEV_VERSION;
export const CLIENT_GIT_SHA = process.env.MMO_GIT_SHA ?? 'dev';
