# Damage numbers: predicted-hit conversion via source-tagged breaks

Damage numbers are a purely client-side realization of `hit`/`break` CombatEvents
(no sim or wire behavior changes). The attacker's own number must come from its
optimistic predicted `hit`, because originator suppression (ADR 0029) means the
attacker never receives its own `hit` from the wire. That leaves a double-count
hazard: when the authority resolves that same swing as a poise `break`, the break
*is* broadcast to the attacker, who would show a second number for one blow — and
breaks are frequent enough (~every few hits) that digits would read as inflated
damage.

Decision: tag `break` events with `source` (mirroring `hit.source`), while keeping
suppression hit-only. A client receiving a break with `source === self` knows
deterministically that this resolves a swing it already predicted, and *converts*
the pending number into the break-styled one instead of spawning another.
Observers, who predicted nothing, render the break number directly.

## Considered Options

- **Replicate poise so the client predicts breaks.** Rejected: poise is contested
  state (other players' hits, super-armor spikes, regen), so prediction would
  misfire — and a phantom break wrongly fires hitstop and camera-kick, which is far
  worse than a doubled number. Break stays authority-only (ADR 0013 §3), and poise
  stays off the wire.
- **Client-side timing-window dedupe** (cancel the youngest predicted number on a
  target when its break arrives within ~RTT). Rejected: a heuristic where an exact
  identity match is available for the cost of one inert protocol field.

## Consequences

- `break.source` is metadata for presentation only; nothing server-side reads it,
  and the suppression filter in `session.ts` must stay `hit`-only or attackers
  lose hitstop/kick on their own meaty hits.
- A `Block`'s chip damage shows no number — a successful block emits no
  CombatEvent at all, consistent with block's deliberately muted presentation.
  If block ever earns its own CombatEvent kind, numbers (and sound/particles)
  pick it up through the same `present` routing for free.
