---
status: accepted
---

# Sound effects: authoritative-triggered, client-realized SoundEffects

The client should be able to play audio to enrich the game, and the open
question was whether a terminal app even can. It can — and we already ship the
engine. The client is a **local native process** (ADR 0002 rejected SSH-as-play;
`bunx`/compiled-binary delivery runs the client on the player's own machine with
direct access to its audio hardware), and **OpenTUI bundles a native audio
engine** (Zig core via Bun FFI) exposing a real mixer: per-voice volume/pan/loop,
named groups with their own volume, a master volume, device selection, and
load-from-memory *or* file. So this is not the terminal bell (`\x07`) and not
shelling out to `afplay` — it is a proper mixer, cross-platform
(CoreAudio/ALSA/WASAPI), with no extra dependency.

The design reuses the split ADR 0013 already established for particles. An
**Effect** is the authoritative, deterministic "what happened"; a **Particle** is
its client-local *visual* realization. A **SoundEffect** (see the glossary) is the
sibling *audible* realization of the very same triggers. The shared layer owns the
fact; the client owns the pixels and the audio.

## Decisions

- **Two feeds, with a sharp rule.** A SoundEffect rides the authoritative channel
  **iff a second player should be able to hear it**; otherwise it is client-local
  and never on the wire. Combat is authoritative and already broadcast, so it
  comes for free: **hit** maps off the existing `blood` **Effect**, **death** off
  the existing `deaths[]` list (both already interest-filtered into the snapshot —
  no new wire vocabulary). Self/UI sounds (your own **jump**, **land**,
  **level-up**, a menu **blip**) are client-local: played directly at the
  interaction site the client already observes. Movement is deliberately
  client-local for now — minting on-wire Effects so others hear your footfalls is
  a lot of protocol for a faint benefit; revisit only if "hear another Avatar
  jump" becomes worth it.

- **Death wins over the coincident hit.** A lethal blow emits *both* a `deaths[]`
  entry *and* a `blood` Effect (the `dir:0` radial burst). The client plays the
  death SoundEffect off `deaths[]` and **suppresses the hit SoundEffect for the
  blood Effect that coincides with a death** in the same tick — the death sound
  is the kill's voice. This reads the existing `deaths[]` signal rather than a
  fragile intensity threshold on `blood`, so audio's hit/death split never couples
  to combat's damage-scale tuning.

- **A `kind → AudioSound` registry, source-agnostic.** Each entry's source is
  either a **synth spec** (the MVP: square/triangle/noise envelopes rendered to a
  PCM/WAV buffer in memory and loaded via `loadSound(bytes)`) or a **file**
  (`loadSoundFile(path)`, a future option for richer `.ogg`/`.wav` foley).
  Swapping one for the other is a one-line registry change per sound with no
  caller change — exactly as `ParticleType` decouples look from simulator. The
  chiptune-native synth is the MVP because it nukes asset-bundling entirely
  (nothing to embed in the compiled binary) and the aesthetic is on-theme for a
  developer terminal game.

- **Best-effort, always optional — a single facade.** One `SoundSystem` owns the
  `Audio` instance and an `enabled` flag. Init is attempted once on client
  startup, **gated on an interactive TTY**, so headless zone-judging (no TTY, per
  the zone-authoring skill), piped/CI runs, and a future SSH spectator never even
  attempt audio. If `Audio.create()` returns null, `start()` returns `false`, or
  the engine's `error` event fires during setup → `enabled = false`, logged once
  at debug level. Every `play(kind, …)` early-returns when disabled — the facade
  is the single choke point, not try/catch at call sites. **`@mmo/core` never
  references audio**: `stepZone()` is byte-identical whether or not anyone can
  hear it, exactly as Sprites and Particles are decoupled from the sim. Dispose on
  clean shutdown, never blocking exit.

- **World sounds are spatialized; self sounds are flat.** At `play()` time, an
  Effect/death-sourced (world) SoundEffect computes `pan` from the source's
  horizontal offset from camera center and `volume` from a distance falloff with a
  hard cutoff radius (past it, skip entirely — mirroring "off-camera Effects
  skipped" in ADR 0013); **y is ignored** (vertical barely reads in stereo for a
  side-scroller). Distance attenuation doubles as the auto-mixer for a busy Zone's
  many Effects. Self/UI SoundEffects play **centered at full volume** — they are
  "you," not "the world," so they must not drift in the stereo field.

- **Buses, default-on, with live control.** Voices are tagged into named groups —
  `combat`, `movement`, `ui`, plus a reserved-but-empty `ambient` so the structure
  doesn't churn later — each with independent volume, under a master volume. Sound
  ships **on by default** (the feature should announce itself), `m` toggles master
  mute instantly, and an **options modal** (in the `Shop`-class mold) exposes
  master + per-bus mute/volume. Prefs persist in the client's first config file
  (see ADR 0015).

## Considered and rejected

- **Terminal bell (`\x07`).** One fixed sound, user-disabled/remapped in most
  terminals, no volume/pan/mix. Unusable as a SoundEffect system.
- **Shelling out to `afplay`/`paplay`/PowerShell.** A per-OS branch, process
  spawn per sound (latency + no mixing), and a fork bomb under combat. The bundled
  OpenTUI mixer is strictly better and dependency-free.
- **Movement/UI sounds on the wire.** Inventing server-authoritative Effects for
  every footfall and menu click is heavy protocol for sounds that are about *you*;
  the two-feed rule keeps them client-local and free.
- **Distinguishing hit from death by an intensity threshold on `blood`.** Couples
  audio bucketing to combat's damage scale; `deaths[]` already exists as the clean
  authoritative signal.
- **Sample-only (ship audio files).** Forces sourcing/licensing binary assets and
  embedding them in both the `bunx` package and the compiled binary on day one.
  Deferred behind the same registry as a future `file:` source.

## Consequences

- The client gains a `SoundSystem` facade, a `kind → AudioSound` registry (MVP:
  synth specs), an `Effect.kind/deaths → SoundEffect` map (sibling to the existing
  particle spawn map), and the hit/death de-dup where Effects and deaths are
  already both in hand.
- No protocol change: hit and death reuse the `blood` Effect and `deaths[]` that
  ADR 0013 / 0006 already put on the snapshot. The offline loop feeds the same
  triggers, so networked and offline audio behave identically.
- Audio is untestable for exact output but the trigger mapping and de-dup are
  pure and unit-testable headlessly; the facade's no-op-when-disabled path is what
  keeps zone-judging and CI silent and unaffected.
