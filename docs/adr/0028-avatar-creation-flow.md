# Avatar creation is server-gated, deferred-spawn, with a Player-typed Handle

**Status:** accepted (amends ADR 0004; relates to ADR 0023, ADR 0024)

The Avatar creator is shown only to brand-new accounts, gated by the **server**
(`store.load(key)` — no Save ⇒ new), never by a client-side flag; a returning
**Identity Key** skips the creator and spawns straight into its last **Town**. A new
Player is authenticated but **not spawned** — and holds **no claimed Handle** — until
they finalise creation: the client sends `createAvatar{handle, cosmetics}`, the server
validates and claims the (now Player-typed, previously auto-derived) **Handle**, mints
the **Save**, and only then spawns the Avatar into Town. The Handle is set **once** at
creation and durable thereafter; in-game re-customization (`[c]`, Town only) sends
`setCosmetics{cosmetics}` and changes **Cosmetics** only, never the Handle. Both
finalise messages funnel through one shared validate/apply/rebroadcast path.

## Why

- **Server-gated, not a client flag.** The character is the SQLite row keyed by the
  Identity Key; only the server knows whether it exists. A client-side "created" flag
  would re-prompt on a new machine or a wiped config even though the Save lives on the
  server — orphaning the "Avatar tied to your Identity Key" model.
- **Deferred spawn.** A new Player must not appear in a shared Town with a placeholder
  Avatar or Handle before finalising. Holding them authenticated-but-unspawned means no
  default Avatar ever flickers into the world and no Handle is claimed until it's real.
- **Typed Handle at creation.** The Handle was auto-derived from `$USER`; making it
  Player-typed (with the auto-derived value as the field's placeholder) gives Players a
  real identity choice while keeping uniqueness enforcement — regex + case-insensitive
  claim — at the single finalise round-trip.
- **"name" in the UI, Handle in the domain (#315).** The creator's field is *labelled*
  "name" throughout its copy (prompt, footer, rejection messages) because "handle" is
  jargon a new Player doesn't recognise; the domain term, the `Handle` type, the wire
  protocol, and CONTEXT.md's glossary stay **Handle**. The relabel is presentation-only.

## Considered and rejected

- **Client-side "created" flag** — simplest, keeps create-before-connect, but
  per-machine and wrong across a key or machine move.
- **Spawn-then-create** (spawn with a default Avatar, customise live over the world) —
  rejected so a new Player never exists in Town before finalising.
- **Live Handle-availability check** as you type — nicer feel, but needs a new protocol
  message + debounce; validate-on-confirm was chosen for the demo.
