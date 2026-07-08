// The single repo-wide release Version, sourced from the git tag (ADR 0012). It stamps the
// published client (baked at build time) and the deployed server (`MMO_VERSION`), carries
// on `hello`, and the server admits a client only when the two strings are equal.

// The sentinel reported when no release Version was baked — i.e. local dev. A server at
// this Version skips the gate (trusts any client); a client at it is rejected by any
// deployed server.
export const DEV_VERSION = 'dev';

// Whether a Version string is a real release (vs. dev sentinel / unset). The server
// enforces the equality gate only when its own Version is a release, so local dev is never
// rejected (ADR 0012).
export function isReleaseVersion(v: string | undefined): v is string {
	return v !== undefined && v !== '' && v !== DEV_VERSION && v !== '0.0.0';
}
