import { expect, test } from 'bun:test';
import type { CapturedFrame, CapturedSpan } from '@opentui/core';
import { createTestRenderer } from '@opentui/core/testing';
import { CharacterCreator, type CreatorKey } from '../src/ui/character-creator';

const HANDLE = 'Neo';

const menuKey = (name: string): CreatorKey => ({
	name,
	sequence: '',
	ctrl: false,
	meta: false,
});

async function mountCreator(nameplate: number) {
	const t = await createTestRenderer({ width: 80, height: 40 });
	const creator = new CharacterCreator(t.renderer, HANDLE, {
		form: 'buddy',
		hue: 0,
		hat: '',
		nameplate,
	});
	creator.attach(t.renderer.root);
	creator.show();
	await t.renderOnce();
	return { ...t, creator };
}

function nameplateSpan(frame: CapturedFrame): CapturedSpan | undefined {
	for (const line of frame.lines) {
		for (const span of line.spans) {
			if (span.text.includes(HANDLE)) return span;
		}
	}
	return undefined;
}

test('the creator preview shows the Handle as a nameplate below the Avatar', async () => {
	const { captureCharFrame, captureSpans } = await mountCreator(0);

	expect(captureCharFrame()).toContain(HANDLE);

	const span = nameplateSpan(captureSpans());
	expect(span).toBeDefined();
	expect(span?.fg.a).toBeGreaterThan(0);
});

test('cycling the nameplate colour re-tints the preview nameplate in real time', async () => {
	const { renderOnce, captureSpans, creator } = await mountCreator(0);

	const before = nameplateSpan(captureSpans());
	expect(before).toBeDefined();

	// ladder is [name, hue, hat, nameplate], so three downs reach Nameplate
	creator.key(menuKey('down'));
	creator.key(menuKey('down'));
	creator.key(menuKey('down'));
	creator.key(menuKey('right'));
	await renderOnce();

	const after = nameplateSpan(captureSpans());
	expect(after).toBeDefined();
	expect(after?.text).toBe(before?.text);
	const changed =
		after?.fg.r !== before?.fg.r ||
		after?.fg.g !== before?.fg.g ||
		after?.fg.b !== before?.fg.b ||
		after?.bg.r !== before?.bg.r ||
		after?.bg.g !== before?.bg.g ||
		after?.bg.b !== before?.bg.b;
	expect(changed).toBe(true);
});
