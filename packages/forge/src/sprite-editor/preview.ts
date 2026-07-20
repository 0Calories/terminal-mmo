// `forge sprite preview <id>` (ADR 0031, issue #340): a live TUI that renders any
// `.sprite` the way the game draws it — the Composited preview outside the editor.
// Loads a sprite by bare id, shows the role-appropriate composition through the
// shared renderer, and re-renders on file save. Controls: `[`/`]` switch animation /
// phase, `.` toggle playback, `m` flip facing, `q` quit. It never writes; it only
// watches the sprites directory and recompiles the live file.
import { readFileSync, watch } from 'node:fs';
import { basename, dirname } from 'node:path';
import {
	buildSceneStyle,
	parseSpriteFile,
	type RenderStyle,
	type SpriteDoc,
} from '@mmo/render';
import type { OptimizedBuffer, RenderContext } from '@opentui/core';
import { Renderable, RGBA } from '@opentui/core';
import type { CliDeps } from '../cli';
import { findSpriteFile, formatSpriteDiagnostics } from '../sprite-cli';
import {
	type CompositeView,
	type PreviewStance,
	previewStances,
	renderComposite,
	styleWithLocalColors,
} from './composite';
import type { SpriteRole } from './templates';
import { roleForDir } from './view';

const CHROME_H = 2;

// Given the previous stance id, find its index in a fresh stance list (a reload
// may have added/removed animations); fall back to the first stance when it is gone.
export function preservedStanceIndex(
	stances: readonly PreviewStance[],
	prevId: string | undefined,
): number {
	if (prevId === undefined) return 0;
	const i = stances.findIndex((s) => s.id === prevId);
	return i >= 0 ? i : 0;
}

export class SpritePreview extends Renderable {
	doc: SpriteDoc;
	readonly role: SpriteRole;
	readonly spriteId: string;
	stances: PreviewStance[];
	stanceIndex = 0;
	facing: 1 | -1 = 1;
	playing = false;
	parseError: string | null = null;
	private elapsedMs = 0;
	private readonly style: RenderStyle<RGBA>;
	private readonly onQuit?: () => void;

	constructor(
		// biome-ignore lint/suspicious/noExplicitAny: opentui ctor ctx type
		ctx: RenderContext | any,
		opts: { id: string; role: SpriteRole; doc: SpriteDoc; onQuit?: () => void },
	) {
		super(ctx, { width: '100%', height: '100%', live: true });
		this.spriteId = opts.id;
		this.role = opts.role;
		this.doc = opts.doc;
		this.onQuit = opts.onQuit;
		this.stances = previewStances(opts.doc, opts.role);
		this.style = buildSceneStyle((r, g, b, a) => RGBA.fromInts(r, g, b, a));
	}

	attach(root: { add: (r: Renderable) => void }): void {
		root.add(this);
	}

	get stanceId(): string {
		return this.stances[this.stanceIndex]?.id ?? 'idle';
	}

	// Swap in a freshly-parsed doc (a save landed), preserving the selected animation
	// when it still exists. A parse failure keeps the last-good art and surfaces
	// the error in the status line, mirroring zone preview.
	reload(doc: SpriteDoc | null, error: string | null): void {
		if (doc) {
			const prev = this.stanceId;
			this.doc = doc;
			this.stances = previewStances(doc, this.role);
			this.stanceIndex = preservedStanceIndex(this.stances, prev);
			this.parseError = null;
		} else {
			this.parseError = error;
		}
		this.requestRender();
	}

	private cycleStance(delta: number): void {
		const n = this.stances.length;
		if (n === 0) return;
		this.stanceIndex = (((this.stanceIndex + delta) % n) + n) % n;
		this.elapsedMs = 0;
		this.requestRender();
	}

	key(k: { name: string; sequence?: string }): void {
		switch (k.name) {
			case '[':
				this.cycleStance(-1);
				return;
			case ']':
				this.cycleStance(1);
				return;
			case 'm':
				this.facing = this.facing === 1 ? -1 : 1;
				this.requestRender();
				return;
			case 'q':
				this.onQuit?.();
				return;
		}
		if (k.sequence === '.') {
			this.playing = !this.playing;
			this.elapsedMs = 0;
			this.requestRender();
		}
	}

	// Advance the playback clock. Public so tests drive time deterministically; the
	// render loop calls it each frame with the real delta.
	tick(deltaMs: number): void {
		if (!this.playing) return;
		this.elapsedMs += deltaMs;
		this.requestRender();
	}

	view(): CompositeView {
		return {
			facing: this.facing,
			stance: this.stanceId,
			elapsedS: this.playing ? this.elapsedMs / 1000 : 0,
		};
	}

	protected renderSelf(buf: OptimizedBuffer): void {
		// Merge the live doc's file-local colours into the render style so custom
		// keys render faithfully rather than falling back to the default (#393).
		const style = styleWithLocalColors(
			this.style,
			this.doc.colors,
			(r, g, b, a) => RGBA.fromInts(r, g, b, a),
		);
		renderComposite(buf, this.doc, this.role, style, this.view());

		const H = buf.height;
		const W = buf.width;
		const chromeBg = RGBA.fromInts(22, 25, 34, 255);
		const text = RGBA.fromInts(232, 232, 238, 255);
		const dim = RGBA.fromInts(140, 148, 164, 255);
		const warn = RGBA.fromInts(255, 180, 80, 255);

		const statusRow = H - CHROME_H;
		buf.fillRect(0, statusRow, W, 1, chromeBg);
		if (this.parseError) {
			buf.drawText(
				`sprite ${this.spriteId}  — parse error: ${this.parseError}`.slice(
					0,
					W,
				),
				0,
				statusRow,
				warn,
				chromeBg,
			);
		} else {
			const face = this.facing === 1 ? '→' : '←';
			const play = this.playing ? ' ▶' : '';
			const status = `sprite ${this.spriteId}  ${this.role}  ${this.stanceId}${play}  facing ${face}`;
			buf.drawText(status.slice(0, W), 0, statusRow, text, chromeBg);
		}

		const helpRow = H - 1;
		buf.fillRect(0, helpRow, W, 1, chromeBg);
		buf.drawText(
			'[ ] animation · . play · m mirror · q quit'.slice(0, W),
			0,
			helpRow,
			dim,
			chromeBg,
		);
	}
}

// The `forge sprite preview <id>` entry point.
export async function runSpritePreview(
	args: string[],
	deps: CliDeps,
): Promise<void> {
	const arg = args[0];
	if (!arg) {
		deps.log('preview: missing <id>');
		process.exitCode = 1;
		return;
	}

	const path = findSpriteFile(deps.root, arg);
	if (!path) {
		deps.log(`preview: no such sprite '${arg}'`);
		process.exitCode = 1;
		return;
	}

	const id = basename(path).replace(/\.sprite$/, '');
	const role = roleForDir(basename(dirname(path)));
	if (!role) {
		deps.log(
			`preview: cannot tell the role of '${path}' — expected sprites/<role>/${id}.sprite`,
		);
		process.exitCode = 1;
		return;
	}

	const first = parseSpriteFile(readFileSync(path, 'utf8'), id);
	if (!first.doc) {
		deps.log(formatSpriteDiagnostics(first.diagnostics));
		process.exitCode = 1;
		return;
	}

	const { createCliRenderer } = await import('@opentui/core');
	const renderer = await createCliRenderer({
		targetFps: 30,
		exitOnCtrlC: true,
		backgroundColor: '#10121a',
	});
	const doQuit = () => {
		(renderer as unknown as { destroy?: () => void }).destroy?.();
		process.exit(0);
	};
	const preview = new SpritePreview(renderer, {
		id,
		role,
		doc: first.doc,
		onQuit: doQuit,
	});
	preview.attach(renderer.root);
	renderer.keyInput.on('keypress', (k: { name: string; sequence?: string }) =>
		preview.key(k),
	);
	renderer.setFrameCallback(async (dt: number) => preview.tick(dt));

	// Watch the directory, not the file: atomic rename saves break a file watch
	// (the zone-preview precedent). Recompile the live file on any change to it.
	const target = `${id}.sprite`;
	watch(deps.root, { recursive: true }, (_event, fname) => {
		if (fname && basename(fname) !== target) return;
		try {
			const parsed = parseSpriteFile(readFileSync(path, 'utf8'), id);
			preview.reload(
				parsed.doc,
				parsed.doc ? null : formatSpriteDiagnostics(parsed.diagnostics),
			);
		} catch (err) {
			preview.reload(null, String(err));
		}
	});

	renderer.start();
}
