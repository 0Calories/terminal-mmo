import type { BodySprite } from '../body-sprite';
import { player } from '../player';
import { Sprite } from '../sprite';

// The launch humanoid Form — the "buddy" — as `FORMS[0]` (ADR 0020 scope). It authors
// the required core (`idle` + the `walkA`/`walkB` stride, §5) plus the single `jump`
// airborne pose; combat leans / hurt / emote frames slot in later through the same
// render path via the idle fallback. `idle` reuses the single-frame body grid (which
// `spriteFor('player')` also serves), keeping one source of truth for the rest pose.
//
// The walk Poses keep `idle`'s torso (rows 0–1) and animate only the feet row, as a
// two-frame open/close stride: `walkA` is the contact frame (legs planted wide), `walkB`
// the passing frame (legs together under the body). The distance-driven selector (ADR
// 0020 §7) alternates them every STRIDE cells of |x|, so the legs visibly open and close
// into a walk (and the renderer mirrors the whole grid for left-facing). Same 9×3
// footprint as idle, so the body anchor is stable across the cycle.
//
// The `jump` Pose holds while the Avatar is airborne (rising or falling), outranking the
// walk cycle (ADR 0020 §6), so being in the air is immediately legible. It reshapes the
// limbs into a leap silhouette distinct from the planted idle and the open/close stride.
// Same 9×3 footprint, so the grip/head anchors and the logical box are unchanged; the
// renderer mirrors it on facing.
//
// The per-Form anchors (ADR 0018 §3): `grip` is the leading mid-body hand the weapon
// hangs from; `head` is the top-centre cell the cosmetic hat rides over. Both are
// mirrored across the body when the Avatar faces left.
//
// VISUAL ARTEFACT — the art here needs design review / sign-off before merge.
const walkA = new Sprite(
	`
·▐██▜█▜▌·
▝▜█████▛▘
·▀·····▀·`,
	{ defaultKey: 'p' },
);

const walkB = new Sprite(
	`
·▐██▜█▜▌·
▝▜█████▛▘
···▀·▀···`,
	{ defaultKey: 'p' },
);

const jump = new Sprite(
	`
▗▟██▜█▜▌·
·▐█████▛▘
 ▀ ·· ·▀·`,
	{ defaultKey: 'p' },
);

// The `wave` emote (ADR 0020 §8/§9) — the launch `oneshot`. The body holds idle's torso
// and feet (an emote is a "standing still and posing" moment, §6) and raises the leading
// arm, animated as a two-frame sweep the selector samples by `emoteT` (EMOTE_FPS): the
// raised hand alternates between `waveA` and `waveB` so the arm visibly waves before the
// oneshot elapses and the body drops back to idle. Same 9×3 footprint, so the grip/head
// anchors and logical box are unchanged; the renderer mirrors it on facing.
const waveA = new Sprite(
	`
▗▟██▜█▜▌·
·▐█████▛▘
··▀···▀··`,
	{ defaultKey: 'p' },
);

const waveB = new Sprite(
	`
·▐██▜█▜▌·
▝▜█████▛▘
··▀···▀··`,
	{ defaultKey: 'p' },
);

// The `dance` emote (ADR 0020 §8/§9) — the launch `loop`. Unlike the oneshot wave it has
// no duration: the two frames cycle until the Avatar moves or fights (§6), sampled by the
// elapsed-sim-time `emoteT` (EMOTE_FPS) so every observer dances in lockstep. `danceA` is
// the "up" beat (both arms raised, feet together); `danceB` the "down" beat (arms out,
// stance wide), so the body bounces side-to-side. Same 9×3 footprint, mirrored on facing.
const danceA = new Sprite(
	`
▗▟██▜█▜▙▖
·▜█████▛·
···▀▀····`,
	{ defaultKey: 'p' },
);

const danceB = new Sprite(
	`
·▐██▜█▜▌·
▟▜█████▛▙
·▀·····▀·`,
	{ defaultKey: 'p' },
);

// The `sit` emote (ADR 0020 §8/§9) — the launch `hold`. A single sustained Pose (the
// selector freezes its frame for a `hold`, so it never animates): the body drops to a
// seated silhouette — head row cleared, torso lowered onto a wide folded-legs base that
// rests on the terrain line. Held until the Avatar moves or fights (§6). Same 9×3
// footprint and baseline, mirrored on facing.
const sit = new Sprite(
	`
·▐██▜█▜▌·
 ▀█████▙▄
·········`,
	{ defaultKey: 'p' },
);

export const buddy: BodySprite = {
	frames: {
		idle: player,
		walkA,
		walkB,
		jump,
		'emote:wave': [waveA, waveB],
		'emote:dance': [danceA, danceB],
		'emote:sit': sit,
	},
	grip: { x: 7, y: 1 },
	head: { x: 4, y: 0 },
	// The feet are ink-top half-blocks (`▀`), so the whole figure drops one cell to land its
	// feet row in the terrain surface cell. The renderer lowers that cell's visible ground to
	// the lower-half block `▄`, so the boot (top half) rests ON the ground line while its
	// air-half shows ground via per-cell compositing — slim, connected, and flush (ADR 0021).
	// idle/walk/jump all share this baseline.
	baseline: 1,
};
