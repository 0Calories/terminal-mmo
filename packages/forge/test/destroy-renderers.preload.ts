// Test preload (wired via bunfig.toml [test].preload): destroys every
// renderer created through `createTestRenderer` once its test finishes.
// Leaked renderers keep the native libopentui render thread churning for the
// rest of the run, which made the suite superlinearly slower as TUI test
// files accumulated. Lives in the forge package so `@opentui/core/testing`
// resolves; the mock keys on the resolved store path, so the client package's
// copy is covered by the same wrapper.
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
		} catch {
			// A renderer that already tore itself down must not fail the test.
		}
	}
});
