export const DEV_VERSION = 'dev';

export function isReleaseVersion(v: string | undefined): v is string {
	return v !== undefined && v !== '' && v !== DEV_VERSION && v !== '0.0.0';
}
