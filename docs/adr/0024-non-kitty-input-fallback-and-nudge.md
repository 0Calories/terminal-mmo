# Non-Kitty Terminal Input: Hard Nudge over a Universal Smooth Fallback

## Context

Movement uses **hold-to-move**: `InputState` (`packages/client/src/input.ts`) keeps a
`held` set and `poll()` turns held `left`/`right` into `moveX`. On terminals that
implement the **Kitty keyboard protocol** (`useKittyKeyboard: { events: true }`),
key-**release** events fire, `releaseCapable` flips true, and the held set is exact —
controls are crisp.

On terminals **without** the protocol there are no release events. "Holding" a key is
really the OS keyboard **auto-repeat** (typematic) synthesising repeated keypresses,
with two properties we do not control and cannot observe around:

1. An **initial repeat delay** (~500ms) between the first press and the second.
2. **Only one key auto-repeats at a time** — press jump while holding right and the OS
   stops repeating right.

`poll()` already infers "still held" with a `HELD_MS` idle timeout, which produces the
two reported symptoms: a **step-then-pause** on the first beat (the timeout expires
inside the initial-delay gap) and **jump-in-place** (holding right + tapping jump:
right's repeats stop, its timeout lapses, horizontal movement dies).

Symptom 2 is **missing information, not a tuning bug**: the terminal never transmits
"right is still down" while another key repeats. No timeout, buffer, or heuristic
reconstructs a signal that was never sent.

## Decision

We do **not** build a one-size-fits-all smooth fallback — it is physically impossible
on a legacy terminal, and faking it with long timeouts would add release latency fatal
to combat (Parry window 0.16s, Dodge i-frames 0.18s — ADR 0017). Hold-to-move stays the
single control model. Instead:

1. **Proactive detection.** Read `renderer.capabilities.kitty_keyboard` (via the
   OpenTUI `capabilities` event), so we know at startup — before the player feels any
   stickiness — rather than relying on the reactive `releaseCapable` flag that only
   learns after the first hold-and-release.
2. **Fail-open.** Treat input capability as adequate unless we are *confident* it is not:
   show the notice only when capabilities have **resolved** AND
   `kitty_keyboard === false`. Timed-out / unresolved / unknown (e.g. high-latency SSH
   where the `ESC[?u` response misses the timeout) stays silent.
3. **Blocking, every-launch, no-opt-out notice.** On confirmed no-kitty, a
   press-to-continue modal explains the controls will feel sticky and how to fix it.
   It is re-detected every launch (so it self-clears the moment the player is on a
   capable terminal) and has **no dismissal persistence and no suppress flag** — a
   deliberate, maximal nudge toward switching terminals.
4. **Self-contained remedy.** The modal embeds a short, build-time-verified list of
   known-good terminals plus a one-line caveat that a multiplexer (tmux/screen) may be
   stripping the protocol from an otherwise-capable terminal — no external URL.
5. **Adaptive two-tier held-key window** (the "modest tune"). Replace the single
   `HELD_MS` with: a **short** base window on first press (crisper taps, releases, and
   precise repositioning than today's 220ms — a gift to tight platforming/combat), and,
   once a second repeat confirms a genuine auto-repeat stream, a **longer** window for
   that key so sustained walking stays solid even if auto-repeat is irregular. Contained
   to `input.ts` and unit-testable with mock timestamps. Starting points (to be tuned
   interactively in a real non-kitty terminal): short ≈140ms, long ≈300ms, confirm on a
   2nd press within ≈600ms.

The two unrecoverable artifacts remain on non-kitty terminals: the **single
initial-beat pause** and **simultaneous-input combos** (hold-direction + action). These
are accepted as the deliberate roughness that motivates switching.

## Considered Options

- **Universal smooth fallback (rejected — impossible).** Cannot sense a held key while
  another auto-repeats; cannot bridge the initial-delay gap without treating every tap
  as a ~500ms hold (≈11 cells of overshoot — walking off ledges).
- **Change the control model to held-key-independent (e.g. momentum/auto-run)
  (rejected).** Would work identically everywhere, but abandons the hold-to-move feel
  we want as the core.
- **Two models, one per terminal (rejected).** Two feels to tune and players on
  different terminals playing differently.
- **Opt-out / persisted dismissal (rejected).** Weakens the nudge; we chose maximal
  pressure to switch, guarded instead by fail-open detection so legit users are not
  trapped.

## Consequences

- A genuine no-kitty player who cannot switch (locked-down/corporate/SSH-only) eats a
  press-to-continue speed bump every launch with no escape. Accepted.
- Fail-open means a real no-kitty player whose capability query *times out* may not see
  the notice; they will feel the stickiness and (intentionally) investigate.
- The embedded terminal list goes stale with the binary and must be re-verified each
  release. Kept short to limit the blast radius.
- Detection and the modal are client-only concerns; no `@mmo/shared` change. The
  adaptive window is pure and testable (`packages/client/test/input.test.ts`); the
  capability path is mockable via `setRendererCapabilities`.
