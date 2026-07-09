import type { Zone } from '@mmo/shared';
import {
	aabbOverlap,
	DEFAULT_COSMETICS,
	entityBox,
	randomCosmetics,
} from '@mmo/shared';
import type { CliRenderer } from '@opentui/core';
import type { ConfigStore } from '../config';
import type { InputState, Scheme } from '../input/movement';
import type { KittyProbe } from '../input/no-kitty-probe';
import { gameKeyHandler, type Key, lobbyKeyHandler } from '../input/ui-keys';
import { sendChatLine } from '../net/chat';
import { NetClient } from '../net/net';
import type { PlayfieldRenderable } from '../render/playfield';
import type { SoundSystem } from '../sound/system';
import { discoverSshIdentity } from '../ssh-auth';
import { AudioOptions } from '../ui/audio-options-view';
import { CharacterCreator } from '../ui/character-creator';
import { Controls } from '../ui/controls';
import type { Hud } from '../ui/hud';
import type { NoKittyNotice, NoticeGate } from '../ui/no-kitty-notice';
import { Shop, type ShopView } from '../ui/shop';
import { GameLoop } from './loop';

export interface SessionDeps {
	renderer: CliRenderer;
	url: string;
	handle: string;
	config: ConfigStore;
	input: InputState;
	hud: Hud;
	playfield: PlayfieldRenderable;
	sound: SoundSystem;
	noKittyNotice: NoKittyNotice;
	gate: NoticeGate;
	kittyProbe: KittyProbe;
	localZone(id: string): Zone;
	scheme: Scheme;
	interactKey: string;
	weapon: number;
	quit(message?: string): void;
	// The SSH identity may carry a notice worth printing after teardown.
	onIdentityNotice(notice: string | null): void;
}

/**
 * The client's lifecycle: authenticate, then either create an Avatar or drop straight
 * into the world. `play()` is what turns the lobby into a running game.
 */
export async function runSession(deps: SessionDeps): Promise<void> {
	const {
		renderer,
		hud,
		input,
		playfield,
		sound,
		noKittyNotice,
		gate,
		kittyProbe,
		quit,
	} = deps;

	const resolved = await discoverSshIdentity(deps.config);
	if (!resolved.ok) {
		quit(resolved.refusal);
		return;
	}
	deps.onIdentityNotice(resolved.notice ?? null);

	const creator = new CharacterCreator(
		renderer,
		deps.handle,
		randomCosmetics((Math.random() * 0x7fffffff) | 0),
	);

	let started = false;
	let creating = false;

	const net = new NetClient(
		deps.url,
		deps.handle,
		resolved.identity,
		(reason) => {
			quit(reason);
		},
		DEFAULT_COSMETICS,
		deps.weapon,
		(isNew) => {
			if (isNew) {
				creating = true;
				creator.attach(renderer.root);
				gate.request(creator);
			} else {
				play();
			}
		},
	);

	net.onCreateRejected = (reason) => {
		creator.showRejection(reason);
	};
	net.onSpawned = () => {
		if (creating) {
			creating = false;
			gate.release(creator);
		}
		play();
	};

	const onLobbyKey = lobbyKeyHandler({
		noKittyNotice,
		dismissNoKittyNotice: () => kittyProbe.dismiss(),
		creating: () => creating,
		submitCreator: (k) => {
			const result = creator.key(k);
			if (!result) return;
			creator.setBusy(true);
			net.send({
				t: 'createAvatar',
				handle: result.handle,
				cosmetics: result.cosmetics,
			});
		},
		blip: () => sound.play('ui'),
		quit,
	});
	renderer.keyInput.on('keypress', (k: Key) => {
		if (started) return;
		onLobbyKey(k);
	});

	function play() {
		if (started) return;
		started = true;
		hud.showAlphaNotice();

		const options = new AudioOptions(renderer, sound);
		options.attach(renderer.root);
		const controls = new Controls(renderer);
		controls.attach(renderer.root);
		const shop = new Shop(renderer);
		shop.attach(renderer.root);
		let recustomize: CharacterCreator | null = null;

		const shopView = (): ShopView => ({
			inventory: net.latest?.inventory ?? [],
			progress: net.latest?.progress ?? { level: 1, xp: 0, gold: 0 },
		});

		const loop = new GameLoop({
			net,
			input,
			hud,
			playfield,
			sound,
			localZone: deps.localZone,
			weapon: deps.weapon,
			modalOpen: () =>
				hud.chatOpen ||
				controls.open ||
				shop.open ||
				options.open ||
				(recustomize?.open ?? false) ||
				noKittyNotice.open,
			syncViews: () => {
				if (shop.open) shop.update(shopView());
			},
		});

		hud.enableChat((text) => {
			const emote = sendChatLine(net, text);
			if (emote) loop.emote(emote);
			hud.closeChat();
		});

		const openRecustomize = (): void => {
			const own = net.ownAvatar();
			const cos = own?.cosmetics ?? DEFAULT_COSMETICS;
			if (!recustomize) {
				// Use the snapshot's handle, not net.handle: this session's net.handle still holds the pre-claim handshake name.
				const durableHandle = own?.handle ?? net.handle;
				recustomize = new CharacterCreator(renderer, durableHandle, cos, false);
				recustomize.attach(renderer.root);
			} else {
				recustomize.reopen(cos);
			}
			input.clear();
			recustomize.show();
		};

		const onGameKey = gameKeyHandler({
			scheme: deps.scheme,
			interactKey: deps.interactKey,
			noKittyNotice,
			dismissNoKittyNotice: () => kittyProbe.dismiss(),
			hud,
			options,
			controls,
			shop,
			shopView,
			buySelected: () => net.send({ t: 'buy', index: shop.selected }),
			sellSelected: () => {
				const inv = shopView().inventory;
				const item = inv[shop.selected];
				if (!item) return;
				net.send({ t: 'sell', itemId: item.id });
				shop.move(0, Math.max(0, inv.length - 1));
			},
			openShop: () => {
				shop.show();
				shop.update(shopView());
			},
			merchantUnder: () => {
				const box = entityBox(loop.avatar);
				return (loop.currentZone.npcs ?? []).some(
					(n) => n.kind === 'vendor' && aabbOverlap(box, n),
				);
			},
			recustomize: () => recustomize,
			submitRecustomize: (k) => {
				const result = recustomize?.key(k);
				if (!result) return;
				net.send({ t: 'setCosmetics', cosmetics: result.cosmetics });
				recustomize?.hide();
			},
			openRecustomize,
			inTown: () => loop.currentZone.type === 'town',
			level: () => net.latest?.progress.level ?? 1,
			notice: (text) => net.notice(text),
			toggleMute: () => sound.toggleMute(),
			blip: () => sound.play('ui'),
			clearHeldKeys: () => input.clear(),
			pressMovement: (name) => input.press(name, performance.now()),
			quit,
		});

		renderer.keyInput.on('keypress', onGameKey);
		renderer.keyInput.on('keyrelease', (k: { name: string }) => {
			if (!hud.chatOpen) input.release(k.name);
		});

		renderer.setFrameCallback(async (dt) => loop.frame(dt));
	}
}
