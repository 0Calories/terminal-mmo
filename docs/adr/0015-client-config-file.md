---
status: accepted
---

# A persisted client config file — the first footprint on the player's disk

Until now the client persisted **nothing** locally: the server URL is baked in at
build time (`server-url.ts`), and the live World is an explicitly ephemeral alpha
(ADR 0009). The sound-effects slice (ADR 0014) needs mute/volume prefs to survive
restarts — a player who mutes should not re-mute every session — which makes
audio the trigger for introducing the client's **first** persisted config. We do
it now, as a *general* settings file rather than an audio-specific one, because a
real game will accumulate client settings (keybinds, theme, last-used Handle) and
the config-file shape is a precedent best set once, deliberately.

## Decisions

- **One general, human-readable config file, XDG-aware.** `~/.config/terminal-mmo/
  config.json` (honoring `XDG_CONFIG_HOME` when set). It is a settings store keyed
  by area; audio (`{ master, muted, buses: { combat, movement, ui } }`) is merely
  its first tenant, not its schema.
- **Tolerant by construction.** A missing file, missing keys, or a corrupt/
  unparseable file all fall back to built-in defaults (sound on) rather than
  erroring — the client must always launch. Writes are best-effort: a failed write
  (read-only home, no permission) degrades to in-memory-only for the session, never
  a crash. Unknown keys are preserved on rewrite so a newer client's settings
  survive an older client.
- **Client-only, never server state.** These are presentation preferences the
  World has no stake in (unlike a Handle or progress); they live on the player's
  machine and are never sent over the wire.

## Considered and rejected

- **In-memory only for the SFX MVP.** Simplest and matches the "ephemeral, resets"
  v0 ethos, but forces re-muting every launch — and we will need persisted settings
  regardless, so paying the cost once here avoids a later migration of where/how
  settings live.
- **An audio-only prefs file.** Would set a narrower precedent that the next
  setting has to break out of. A general settings file costs the same to build.
- **Env-var-only control (`MMO_MUTE`, `MMO_VOLUME`).** Scriptable but undiscoverable
  and a poor fit for a live options modal; kept available as an override, not the
  store.

## Consequences

- This is the first thing the client writes to the user's disk — call it out in
  user-facing docs so it is not a surprise.
- Future client settings (keybinds, theme, …) extend this file by adding a top-
  level area key; they inherit the tolerant load/merge/rewrite behavior rather than
  re-deciding persistence.
