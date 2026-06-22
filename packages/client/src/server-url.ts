// Single source of truth for the live server's address (ADR 0009 / 0012). The
// client bakes the wss:// URL into its published bundle to reach the World; the
// release pipeline reads PROD_SERVER_HOST from THIS file (by path, in `release.yml`)
// to derive the https:// /health URL it gates the publish on. Stored as the bare
// host so both forms come from one string — change the host here and nowhere else.
import { isReleaseVersion } from '@mmo/shared';

export const PROD_SERVER_HOST = 'mmoserver-production-c9d8.up.railway.app';
export const PROD_SERVER_URL = `wss://${PROD_SERVER_HOST}`;

// Where a from-source (dev) client connects by default — the local dev server on its
// default port (MMO_PORT, 8080; see packages/server/src/index.ts). Run `bun run
// dev:server` alongside `bun run dev:client`.
export const LOCAL_SERVER_URL = 'ws://localhost:8080';

// Resolve which server the client connects to (ADR 0009 / 0012):
//   1. An explicit MMO_SERVER override always wins (e.g. a remote dev box).
//   2. Otherwise a from-source client (`dev` version) targets the LOCAL dev server —
//      a deployed server rejects a `dev` client at its version gate, so defaulting it
//      to prod is a guaranteed failure.
//   3. A published (release-versioned) client targets the production World.
export function resolveServerUrl(
	override: string | undefined,
	version: string,
): string {
	if (override) return override;
	return isReleaseVersion(version) ? PROD_SERVER_URL : LOCAL_SERVER_URL;
}
