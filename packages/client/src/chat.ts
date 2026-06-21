// Chat typing mode (#34, retained-UI side of ADR 0005). A small framework-free
// state machine over keystrokes: while open it OWNS every key, so the play-mode
// input never sees them and typing can't leak into movement / combat. The caller
// adapts OpenTUI key events to ChatKey and acts on the returned ChatKeyResult.

import { CHAT_MAX_LEN } from '@mmo/shared';

// The fields of a key event ChatInput cares about. `sequence` is the literal
// character a printable key produced (OpenTUI's ParsedKey.sequence).
export interface ChatKey {
	name: string;
	sequence?: string;
	ctrl?: boolean;
	meta?: boolean;
}

export type ChatKeyResult =
	| { action: 'send'; text: string } // Enter on a non-empty line: send + close
	| { action: 'cancel' } // Escape, or Enter on an empty line: close
	| { action: 'edit' } // buffer changed / harmless key, stay open
	| { action: 'none' }; // chat closed: caller handles the key normally

const MAX_LEN = CHAT_MAX_LEN; // matches the server's relay clamp (#59, ADR 0007)

export class ChatInput {
	open = false;
	text = '';

	// Enter typing mode with an empty line.
	start(): void {
		this.open = true;
		this.text = '';
	}

	// Leave typing mode, discarding any draft.
	cancel(): void {
		this.open = false;
		this.text = '';
	}

	// Feed one key. Returns 'none' when closed (the caller treats it as play input);
	// otherwise the key is consumed and the result says what to do.
	key(k: ChatKey): ChatKeyResult {
		if (!this.open) return { action: 'none' };
		if (k.name === 'return') {
			const text = this.text.trim();
			this.cancel();
			return text ? { action: 'send', text } : { action: 'cancel' };
		}
		if (k.name === 'escape') {
			this.cancel();
			return { action: 'cancel' };
		}
		if (k.name === 'backspace') {
			this.text = this.text.slice(0, -1);
			return { action: 'edit' };
		}
		// Swallow control/meta combos without inserting; never let them through.
		if (k.ctrl || k.meta) return { action: 'edit' };
		const ch = k.name === 'space' ? ' ' : (k.sequence ?? '');
		if (
			ch.length === 1 &&
			ch >= ' ' &&
			ch !== '\x7f' &&
			this.text.length < MAX_LEN
		)
			this.text += ch;
		return { action: 'edit' };
	}
}
