// The live server's address (ADR 0009 / 0012). release.yml reads PROD_SERVER_HOST from
// this file by path to derive the https:// /health URL it gates publish on, so keep it the
// bare host — both the wss:// and https:// forms derive from this one string.
import { isReleaseVersion } from '@mmo/shared';

export const PROD_SERVER_HOST = 'mmoserver-production-c9d8.up.railway.app';
export const PROD_SERVER_URL = `wss://${PROD_SERVER_HOST}`;

// The from-source (dev) client's default target: the local dev server (MMO_PORT, 8080).
export const LOCAL_SERVER_URL = 'ws://localhost:8080';

// A from-source (`dev`) client defaults to LOCAL, not prod: a deployed server rejects a `dev`
// client at its version gate, so defaulting it to prod would just guarantee failure (an
// explicit override still wins). (ADR 0009 / 0012)
export function resolveServerUrl(
	override: string | undefined,
	version: string,
): string {
	if (override) return override;
	return isReleaseVersion(version) ? PROD_SERVER_URL : LOCAL_SERVER_URL;
}
