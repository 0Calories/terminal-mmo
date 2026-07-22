// release.yml reads PROD_SERVER_HOST from this file by path, so keep it the bare host.
import { isReleaseVersion } from '@mmo/core/protocol';

export const PROD_SERVER_HOST = 'mmoserver-production-c9d8.up.railway.app';
export const PROD_SERVER_URL = `wss://${PROD_SERVER_HOST}`;

export const LOCAL_SERVER_URL = 'ws://localhost:8080';

export function resolveServerUrl(
	override: string | undefined,
	version: string,
): string {
	if (override) return override;
	return isReleaseVersion(version) ? PROD_SERVER_URL : LOCAL_SERVER_URL;
}
