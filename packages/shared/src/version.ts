// The single repo-wide release Version (ADR 0012). One number, sourced from the
// git tag, stamps both the published client (baked into the bundle at build time)
// and the deployed server (`MMO_VERSION`, set by the release pipeline). It carries
// on `hello`, and the deployed server admits a client only when the two strings
// are equal — replacing the old hand-bumped `PROTOCOL_VERSION` integer. The bump is
// now intrinsic to cutting a tag, so it can't be forgotten.

// The sentinel a client or server reports when no release Version was baked/injected
// — i.e. running from source in local dev. A server at this Version skips the gate
// (trusts any client); a client at it is rejected by any *deployed* server.
export const DEV_VERSION = 'dev';

// Whether a Version string is a real release (vs. the dev sentinel / unset). The
// deployed server only enforces the equality gate when its own Version is a release;
// a dev server accepts anyone, so local dev is never rejected (ADR 0012).
export function isReleaseVersion(v: string | undefined): v is string {
	return v !== undefined && v !== '' && v !== DEV_VERSION && v !== '0.0.0';
}
