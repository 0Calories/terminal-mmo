// The sentinel reported when no release Version was baked — local dev skips the version gate.
export const DEV_VERSION = 'dev';

export function isReleaseVersion(v: string | undefined): v is string {
	return v !== undefined && v !== '' && v !== DEV_VERSION && v !== '0.0.0';
}
