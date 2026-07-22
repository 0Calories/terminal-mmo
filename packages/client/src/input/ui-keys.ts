import type { ShopView } from '../ui/shop';
import type { Scheme } from './movement';

export interface Key {
	name: string;
	sequence: string;
	ctrl: boolean;
	meta: boolean;
	preventDefault(): void;
}

export function isHelpKey(k: { name: string; sequence?: string }): boolean {
	return k.name === '?' || k.sequence === '?';
}

const MENU_BLIP_KEYS = new Set(['up', 'down', 'left', 'right', 'return']);

export function isMenuBlipKey(name: string): boolean {
	return MENU_BLIP_KEYS.has(name);
}

interface Overlay {
	readonly open: boolean;
	hide(): void;
}

export interface LobbyKeyDeps {
	noKittyNotice: { readonly open: boolean };
	dismissNoKittyNotice(): void;

	creating(): boolean;
	submitCreator(k: Key): void;
	blip(): void;
	quit(): void;
}

export function lobbyKeyHandler(deps: LobbyKeyDeps): (k: Key) => void {
	return (k) => {
		if (deps.noKittyNotice.open) {
			deps.dismissNoKittyNotice();
			return;
		}
		if (!deps.creating()) {
			if (k.name === 'q') deps.quit();
			return;
		}
		if (isMenuBlipKey(k.name)) deps.blip();
		deps.submitCreator(k);
	};
}

export interface GameKeyDeps {
	scheme: Scheme;
	interactKey: string;
	noKittyNotice: { readonly open: boolean };
	dismissNoKittyNotice(): void;
	hud: { readonly chatOpen: boolean; openChat(): void; closeChat(): void };
	options: Overlay & { show(): void; key(name: string): void };
	controls: Overlay & { show(level: number, scheme: Scheme): void };
	shop: Overlay & {
		readonly mode: 'sell' | 'buy';
		count(view: ShopView): number;
		switchTab(): void;
		move(delta: number, count: number): void;
		update(view: ShopView): void;
	};
	shopView(): ShopView;
	buySelected(): void;
	sellSelected(): void;
	openShop(): void;
	merchantUnder(): boolean;

	recustomize(): Overlay | null;
	submitRecustomize(k: Key): void;
	openRecustomize(): void;
	inTown(): boolean;
	level(): number;
	notice(text: string): void;
	toggleMute(): void;
	blip(): void;

	clearHeldKeys(): void;
	pressMovement(name: string): void;
	quit(): void;
}

function shopKeyHandler(deps: GameKeyDeps): (name: string) => void {
	return (name) => {
		if (isMenuBlipKey(name)) deps.blip();
		const count = deps.shop.count(deps.shopView());
		switch (name) {
			case 'left':
			case 'right':
				deps.shop.switchTab();
				break;
			case 'up':
				deps.shop.move(-1, count);
				break;
			case 'down':
				deps.shop.move(1, count);
				break;
			case 'return':
				if (deps.shop.mode === 'buy') deps.buySelected();
				else deps.sellSelected();
				break;
			case deps.interactKey:
			case 'escape':
				deps.shop.hide();
				break;
		}
		if (deps.shop.open) deps.shop.update(deps.shopView());
	};
}

export function gameKeyHandler(deps: GameKeyDeps): (k: Key) => void {
	const handleShopKey = shopKeyHandler(deps);
	return (k) => {
		if (deps.noKittyNotice.open) {
			deps.dismissNoKittyNotice();
			return;
		}
		if (deps.hud.chatOpen) {
			if (k.name === 'escape') deps.hud.closeChat();
			return;
		}
		if (k.name === 'q') deps.quit();
		if (deps.options.open) {
			deps.options.key(k.name);
			return;
		}
		if (deps.controls.open) {
			if (isHelpKey(k) || k.name === 'escape') deps.controls.hide();
			return;
		}
		if (k.name === 'm') {
			deps.toggleMute();
			return;
		}
		if (deps.shop.open) {
			handleShopKey(k.name);
			return;
		}
		const recustomize = deps.recustomize();
		if (recustomize?.open) {
			if (isMenuBlipKey(k.name)) deps.blip();
			if (k.name === 'escape') {
				recustomize.hide();
				return;
			}
			deps.submitRecustomize(k);
			return;
		}
		if (isHelpKey(k)) {
			deps.controls.show(deps.level(), deps.scheme);
			return;
		}
		if (k.name === 'o') {
			deps.options.show();
			return;
		}
		if (k.name === 'c') {
			if (deps.inTown()) deps.openRecustomize();
			else deps.notice('Re-customize in Town.');
			return;
		}
		if (k.name === 'return') {
			k.preventDefault();
			deps.hud.openChat();
			deps.clearHeldKeys();
			return;
		}
		if (k.name === deps.interactKey && deps.merchantUnder()) {
			deps.clearHeldKeys();
			deps.openShop();
			return;
		}
		deps.pressMovement(k.name);
	};
}
