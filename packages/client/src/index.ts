import { loadZones } from '@mmo/assets';
import { DEFAULT_WEAPON, WEAPONS } from '@mmo/core/combat';
import type { Zone } from '@mmo/core/world';
import { createCliRenderer, type TerminalCapabilities } from '@opentui/core';
import { ConfigStore } from './config';
import { runSession } from './game/session';
import { InputState } from './input/movement';
import { KittyProbe } from './input/no-kitty-probe';
import { PlayfieldRenderable } from './render/playfield';
import { resolveServerUrl } from './server-url';
import { SoundSystem } from './sound/system';
import { Hud } from './ui/hud';
import { NoKittyNotice, NoticeGate } from './ui/no-kitty-notice';
import { CLIENT_VERSION } from './version';

const RENDER_FPS = Number(process.env.MMO_FPS) || 120;
const SERVER = resolveServerUrl(process.env.MMO_SERVER, CLIENT_VERSION);
const SCHEME = process.env.MMO_SCHEME === 'mouse' ? 'mouse' : 'keyboard';
const INTERACT_KEY = SCHEME === 'mouse' ? 'f' : 'e';

function selectWeapon(): number {
	const raw = (process.env.MMO_WEAPON ?? '').trim();
	if (!raw) return DEFAULT_WEAPON;
	const byName = WEAPONS.findIndex(
		(w) => w.name.toLowerCase() === raw.toLowerCase(),
	);
	if (byName >= 0) return byName;
	const idx = Number(raw);
	return Number.isInteger(idx) && idx >= 0 && idx < WEAPONS.length
		? idx
		: DEFAULT_WEAPON;
}

function selectHandle(): string {
	const fromUser = (process.env.USER || '')
		.replace(/[^A-Za-z0-9_-]/g, '-')
		.slice(0, 16);
	return (
		process.env.MMO_HANDLE || (fromUser.length >= 2 ? fromUser : 'wanderer')
	);
}

const LOCAL_ZONES = new Map<string, Zone>(loadZones().map((z) => [z.id, z]));
function localZone(id: string): Zone {
	return LOCAL_ZONES.get(id) ?? LOCAL_ZONES.get('field-01') ?? loadZones()[0];
}

const renderer = await createCliRenderer({
	targetFps: RENDER_FPS,
	exitOnCtrlC: true,
	backgroundColor: '#10121a',
	// events: true reports key releases, needed for continuous held movement.
	useKittyKeyboard: { events: true },
});

const input = new InputState(SCHEME);

const playfield = new PlayfieldRenderable(renderer);
renderer.root.add(playfield);
if (SCHEME === 'mouse') {
	playfield.onMouseDown = (e: { button: number }) => input.mouseDown(e.button);
	playfield.onMouseUp = (e: { button: number }) => input.mouseUp(e.button);
}

const hud = new Hud(renderer);
hud.attach(renderer.root);

const noKittyNotice = new NoKittyNotice(renderer);
noKittyNotice.attach(renderer.root);
const gate = new NoticeGate(noKittyNotice);
const kittyProbe = new KittyProbe({
	notice: noKittyNotice,
	capabilities: () => renderer.capabilities,
	onNoticeChanged: () => gate.reconcile(),
});
renderer.on('capabilities', (capabilities: TerminalCapabilities) =>
	kittyProbe.observe(capabilities),
);

const sound = new SoundSystem({ debug: process.env.MMO_DEBUG === '1' });
playfield.sound = sound;

const config = new ConfigStore().load();
sound.applyAudioPrefs(config.audio());
sound.onChange = () => config.saveAudio(sound.audioPrefs());
let audioDegraded = false;
sound.onDegraded = () => {
	audioDegraded = true;
};

let identityNotice: string | null = null;

function quit(message?: string) {
	sound.dispose();
	try {
		(renderer as unknown as { destroy?: () => void }).destroy?.();
	} catch {}
	// Print after teardown so it lands on the normal screen, not the cleared alt-screen.
	if (audioDegraded)
		console.error('audio disabled after repeated engine errors this session');
	if (identityNotice) console.error(identityNotice);
	if (message) console.error(message);
	process.exit(message ? 1 : 0);
}

runSession({
	renderer,
	url: SERVER,
	handle: selectHandle(),
	config,
	input,
	hud,
	playfield,
	sound,
	noKittyNotice,
	gate,
	kittyProbe,
	localZone,
	scheme: SCHEME,
	interactKey: INTERACT_KEY,
	weapon: selectWeapon(),
	quit,
	onIdentityNotice: (notice) => {
		identityNotice = notice;
	},
});

renderer.start();
