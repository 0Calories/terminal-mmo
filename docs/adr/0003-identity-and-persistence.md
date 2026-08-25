---
status: accepted
---

# Identity: SSH-key auth, durable Handles, durable Saves

## Decisions

- **Players authenticate by SSH-key challenge-response** (ssh-ed25519 only) —
  passwordless, terminal-native, no browser hop. The client signs a
  server-issued nonce (domain-separated so signatures can't be replayed across
  protocols) via ssh-agent or `~/.ssh/id_ed25519`; the server verifies against
  the registered public key. Verifier and claim registry are pure functions in
  `@mmo/core`.
- **A keyless launch mints its own identity instead of refusing.** When no
  usable external key is found, the client generates an ed25519 keypair in its
  config dir and plays with it. A per-machine **anchor** in `config.json`
  records which key won last: a momentarily-unreachable external key is
  refused with guidance ("run `ssh-add` and relaunch"), never silently
  replaced — replacement would orphan the Save.
- **The Handle is a durable, unique username claimed once at Avatar creation**,
  bound to the Identity Key. Creation is **server-gated and deferred-spawn**:
  only the server knows whether a Save exists (a client-side "created" flag
  breaks on a new machine), and a new Player never appears in Town until they
  finalise.
- **Saves live in `bun:sqlite` on a mounted volume and survive Releases.**
  Keyed by Identity Key; hold progression and identity only (level/XP/Gold,
  inventory + equipment, cosmetics, last Town) — never Monsters, transient
  Zone state, or exact position; login returns you to your last Town. Written
  on significant events + periodic flush behind a pure store seam, never
  per-tick. Save schema policy: JSON blobs, additive changes only, absent
  fields tolerated, meanings never repurposed — there are no migrations.
- **The server snapshots the database on boot** (timestamped copies on the
  volume, last few kept) before opening it — the restore point for a
  data-corrupting Release. A failed snapshot logs loudly but never blocks
  boot.
- **One persisted client config file** (`~/.config/terminal-mmo/config.json`,
  XDG-aware) holds presentation prefs and the identity anchor. Tolerant by
  construction: missing/corrupt files fall back to defaults, failed writes
  degrade to in-memory — the client must always launch. Client-only, never
  sent over the wire.
