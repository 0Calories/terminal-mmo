// Headless render checks for the Avatar creator preview (#303). The pure geometry of
// previewAvatar is covered in character-creator.test.ts; here we render the whole
// CharacterCreator through the shared renderer (via @opentui/core/testing) and assert
// the Nameplate — whose text IS the Handle (CONTEXT.md) — shows below the Avatar and
// re-tints live as the colour is cycled.
import { expect, test } from 'bun:test';
import type { CapturedFrame, CapturedSpan } from '@opentui/core';
import { createTestRenderer } from '@opentui/core/testing';
import { CharacterCreator, type CreatorKey } from '../src/character-creator';

const HANDLE = 'Neo';

// A menu keypress for the creator (#304 changed `key()` to take a structural CreatorKey rather
// than a bare name): navigation keys carry no printable sequence.
const menuKey = (name: string): CreatorKey => ({
	name,
	sequence: '',
	ctrl: false,
	meta: false,
});

async function mountCreator(nameplate: number) {
	const t = await createTestRenderer({ width: 80, height: 40 });
	const creator = new CharacterCreator(t.renderer, HANDLE, {
		form: 0,
		hue: 0,
		hat: 0,
		nameplate,
	});
	creator.attach(t.renderer.root);
	creator.show();
	await t.renderOnce();
	return { ...t, creator };
}

// The Nameplate is drawn as bare Handle glyphs on their own tinted backing, so the
// whole Handle lands in a single captured span (its cells share one ink/bg, distinct
// from the surrounding scene). Return it so a test can read its tint.
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

	// The Handle text is present in the rendered preview...
	expect(captureCharFrame()).toContain(HANDLE);

	// ...as a real nameplate span, tinted (a non-transparent ink over its backing).
	const span = nameplateSpan(captureSpans());
	expect(span).toBeDefined();
	expect(span?.fg.a).toBeGreaterThan(0);
});

test('cycling the nameplate colour re-tints the preview nameplate in real time', async () => {
	const { renderOnce, captureSpans, creator } = await mountCreator(0);

	const before = nameplateSpan(captureSpans());
	expect(before).toBeDefined();

	// Focus the Nameplate field (Form is hidden, so the picker rows are hue, hat,
	// nameplate) and cycle its colour one step.
	creator.key(menuKey('down'));
	creator.key(menuKey('down'));
	creator.key(menuKey('right'));
	await renderOnce();

	const after = nameplateSpan(captureSpans());
	expect(after).toBeDefined();
	// Same Handle text, a visibly different tint — the whole point of the fix.
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
