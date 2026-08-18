export interface BuildStamp {
	version: string;
	gitSha: string;
	contractHash: string;
}

export function makeStamp(fields: BuildStamp): BuildStamp {
	const version = fields.version.trim();
	const gitSha = fields.gitSha.trim();
	const contractHash = fields.contractHash.trim();
	if (!version || !gitSha || !contractHash) {
		throw new Error('build stamp requires version, gitSha, and contractHash');
	}
	return { version, gitSha, contractHash };
}

export function parseStamp(json: string): BuildStamp | undefined {
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch {
		return undefined;
	}
	if (typeof raw !== 'object' || raw === null) return undefined;
	const { version, gitSha, contractHash } = raw as Record<string, unknown>;
	if (
		typeof version !== 'string' ||
		typeof gitSha !== 'string' ||
		typeof contractHash !== 'string'
	) {
		return undefined;
	}
	try {
		return makeStamp({ version, gitSha, contractHash });
	} catch {
		return undefined;
	}
}

export function assertBootIdentity(options: {
	railwayEnv: string | undefined;
	stamp: BuildStamp | undefined;
	recomputedHash: string;
}): void {
	const { railwayEnv, stamp, recomputedHash } = options;
	if (stamp === undefined) {
		if (!railwayEnv) return;
		throw new Error(
			`RAILWAY_ENVIRONMENT is "${railwayEnv}" but build-info.json is missing — ` +
				'this image was deployed without a stamp. Run the stamp script, then `railway up`.',
		);
	}
	if (stamp.contractHash !== recomputedHash) {
		throw new Error(
			`stamped contract hash ${stamp.contractHash} does not match the hash of loaded content ` +
				`${recomputedHash} — stale or tampered image. Re-run the stamp script and redeploy.`,
		);
	}
}
