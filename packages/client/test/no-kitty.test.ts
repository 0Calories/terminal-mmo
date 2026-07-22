import { expect, test } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import { CharacterCreator } from '../src/ui/character-creator';
import {
	type Gateable,
	NoKittyNotice,
	NoticeGate,
} from '../src/ui/no-kitty-notice';

const STARTER_LOOK = { hue: 0, hat: '', nameplate: 0, form: 'buddy' } as const;

test('the terminal notice gates the creator until dismissal', async () => {
	const { renderer, renderOnce } = await createTestRenderer({
		width: 100,
		height: 40,
		kittyKeyboard: false,
	});
	const notice = new NoKittyNotice(renderer);
	const creator = new CharacterCreator(renderer, 'tester', STARTER_LOOK);
	notice.attach(renderer.root);
	creator.attach(renderer.root);
	const gate = new NoticeGate(notice);

	notice.show();
	gate.request(creator);
	await renderOnce();
	expect(notice.open).toBe(true);
	expect(creator.open).toBe(false);

	notice.hide();
	gate.reconcile();
	await renderOnce();
	expect(notice.open).toBe(false);
	expect(creator.open).toBe(true);
});

function fakeModal(): Gateable & { visible: boolean } {
	return {
		visible: false,
		get open() {
			return this.visible;
		},
		show() {
			this.visible = true;
		},
		hide() {
			this.visible = false;
		},
	};
}

test('NoticeGate reconciles modal visibility as notice state changes', () => {
	const notice = { open: false };
	const gate = new NoticeGate(notice);
	const modal = fakeModal();

	gate.request(modal);
	expect(modal.open).toBe(true);
	notice.open = true;
	gate.reconcile();
	expect(modal.open).toBe(false);
	notice.open = false;
	gate.reconcile();
	expect(modal.open).toBe(true);
});

test('a released modal stays hidden across later notice reconciliation', () => {
	const notice = { open: true };
	const gate = new NoticeGate(notice);
	const modal = fakeModal();
	gate.request(modal);
	expect(modal.open).toBe(false);

	gate.release(modal);
	notice.open = false;
	gate.reconcile();
	expect(modal.open).toBe(false);
});
