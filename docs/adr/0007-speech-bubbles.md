---
status: accepted
---

# Speech bubbles: over-head chat on the playfield, and session id on the chat frame

A Speech bubble shows a Player's latest Chat message floating above their Avatar's
head, visible to everyone in the same Zone + Channel. Building it forced two
decisions that a future reader would otherwise find surprising — so they are
recorded here. Neither changes the Channel-scoped relay from ADR 0006 (the message
already fans out to the whole Zone + Channel); the bubble is a new *rendering* of a
message the client already receives.

## Decisions

- **The bubble renders on the imperative playfield, not as retained chrome.** It is
  drawn inside `PlayfieldRenderable.renderSelf` alongside Sprites and nameplates,
  not as an OpenTUI/React widget. This *qualifies* ADR 0005, which lists "chat log +
  whisper input" as retained UI: the **log** is retained chrome, but the **bubble**
  is on the hot path — it is anchored to a moving Avatar, re-projected through the
  camera every frame, and must occlude terrain. Putting it in retained UI would pull
  a per-frame-changing element into the React diff that ADR 0005 exists to keep off
  the playfield. The retained/imperative seam is drawn by *update frequency*, and an
  over-head bubble is high-frequency.

- **The server→client chat frame carries the sender's `sessionId`.** The bubble must
  attach to a *sprite*, and sprites are addressed by `sessionId` (the
  `AvatarSnapshot` identity, mirrored as `entity.id`). A Handle is a display label,
  not an identity (no uniqueness guarantee), so it cannot safely address an entity.
  The server already holds `me.sessionId` at the relay, so this is one `u32` added to
  the frame — round-trippable per the ADR 0006 codec. The bubble then re-reads that
  entity's live position each frame, so it tracks the Avatar as it moves.

## Considered and rejected

- **Bubble as a retained overlay positioned over the avatar.** Reintroduces a
  per-frame-mutating node into the retained tree — the exact ADR 0005 anti-pattern.
- **Client-side `handle → sessionId` lookup (no wire change).** Ambiguous when two
  Avatars share a Handle, and stale when the sender just left the snapshot. Rejected
  because Handle is not identity.
- **Server sends the sender's `(x, y)` in the chat message.** The position is frozen
  at send time, so the bubble detaches as the Avatar walks; redundant with the
  snapshot the client already has.
- **Unbounded bubble height for long messages.** A 200-char message towered ~10 rows
  and clipped off the top of the screen, silently losing its top. Resolved upstream:
  Chat is capped at **120 chars**, enforced at the input (you cannot type past it)
  and clamped server-side; the bubble wraps and fits-to-space-then-ellipsis as a
  screen-edge safety net.

## Consequences

- `protocol.ts` gains `sessionId` on the `chat` server message (encode + decode +
  round-trip test). Client and server ship together (ADR 0006: no external clients,
  no version skew), so the field is added in lockstep.
- The client keeps transient bubble state — `Map<sessionId, { text, ttl }>` —
  co-located with `chatLog` on the net client, decayed by `dt` in the frame callback
  (`ttl = clamp(2 + 0.05 · len, 3, 7)`s), and consumed by the playfield each frame.
  A bubble whose `sessionId` is absent from the current frame is simply not drawn.
- The 200→120 char cap is a behavior change to Chat (#34), shared by the log and the
  bubble.
