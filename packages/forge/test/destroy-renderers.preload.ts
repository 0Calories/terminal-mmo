import { afterEach, mock } from 'bun:test';
import * as opentuiTesting from '@opentui/core/testing';

const realCreate = opentuiTesting.createTestRenderer;
const live: Array<{ destroy?: () => void }> = [];

mock.module('@opentui/core/testing', () => ({
	...opentuiTesting,
	createTestRenderer: async (opts: unknown) => {
		const t = await realCreate(opts as Parameters<typeof realCreate>[0]);
		live.push(t.renderer as unknown as { destroy?: () => void });
		return t;
	},
}));

afterEach(() => {
	while (live.length) {
		try {
			live.pop()?.destroy?.();
		} catch {}
	}
});
