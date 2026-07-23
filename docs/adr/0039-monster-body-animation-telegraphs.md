# Monster telegraphs are body Animations; the overlay glyph is a dead end

Monster attack reads move from the stamped overlay glyph (`drawSwing`) to real
body Animations: a monster's Body sprite may author `windup`, `attack`, and
`recovery` Animations, and a small pure selector maps replicated entity state to
an animation name — Attack phase → its animation, off-ground → `airborne`, else
`idle` — with any missing name falling back to `idle`. Phase-bound animations
are sampled by **phase progress**, never fps, exactly as ADR 0036 fixed for the
weapon `swing`: authoring more frames smooths the telegraph but can never change
its duration or desync it from the hitbox timing, and every observer derives the
identical frame from replicated state.

We deliberately lay the foundation only. The first consumer is the Slime
(pounce archetype); the chaser/shooter/brute keep the overlay glyph until each
authors its own attack frames — retirement is per-monster art work, not further
engine work. A monster graduates by authoring frames; once it does, the overlay
is suppressed for it. We rejected retiring the overlay in one sweep (it
multiplies one feature's art scope across every monster, and each monster's
attack read deserves its own design pass) and rejected fps-timed attack
animations (an animation clock can drift from the phase clock, breaking the
telegraph contract that the body language *is* the hitbox timing).
