---
status: accepted
---

# SSH-key passwordless authentication

The game's audience is developers/CLI users, who all already have SSH keys. We
authenticate players by SSH-key challenge-response rather than passwords or
(initially) OAuth.

## Decision

- On first launch, the client signs a server-issued challenge (nonce) with the
  player's SSH private key — via `ssh-agent` or `~/.ssh/id_ed25519` — and the
  server verifies the signature against the registered public key.
- **First time = register:** claim a username, bind the public key to it.
- Passwordless: no password storage, no browser round-trip, fully terminal-native.

## Considered and rejected (for now)

- **GitHub OAuth (device flow)** — also developer-native and a good *secondary*
  option later, but requires a browser hop. Kept as a future alternate.
- **Username/password** — boring, and makes us responsible for password security.

## Consequences

- Players must have an SSH key (a safe assumption for this audience).
- Identity is a public key ↔ username binding; account recovery / key rotation is
  a future concern (acceptable for a pet project).
- Pairs naturally with the parked idea of using SSH as an encrypted transport
  tunnel later (ADR 0002), though v1 transport remains WebSocket.

## Amendment (2026-07-03, D2 #235): implemented — the concrete shape

- **ssh-ed25519 only.** The one key type this ADR names, and the modern default
  (`ssh-keygen -t ed25519`). Any other key gets a clear refusal with that command
  as the fix, not a protocol error.
- **Handshake:** `hello` carries the offered public key → server answers with a
  32-byte nonce `challenge` → client signs and sends `proof` → a verified proof
  earns `welcome`, which carries the durable Handle. The signed payload is
  domain-separated (`terminal-mmo-auth-v1` ‖ nonce) so a signature can never be
  replayed from/into another raw-bytes protocol using the same key.
- **The verifier and the claim registry are pure functions in `@mmo/shared`**
  (`auth.ts`): socket-free, seam-tested. The registry is held in memory by the
  server; #236 moves it behind bun:sqlite without touching the seam.
- **Handle revised (vs ADR 0006):** the claimed username IS the Handle — durable
  and unique (case-insensitive). A returning key resolves to its registered
  Handle regardless of what the launch asked for, and one identity has one
  online presence at a time.
- **Client signing order:** ssh-agent first (works with passphrase-protected
  keys), then an unencrypted `~/.ssh/id_ed25519` directly. No passphrase prompt
  — a protected key without an agent is refused with guidance.

## Amendment (2026-07-07): auto-generated fallback identity — nobody locked out

The original ADR's load-bearing assumption ("players must have an SSH key — a
safe assumption for this audience") is *false* for the frozen demo: a keyless
playtester hit "No usable SSH key found" and could not play at all. For a demo
handed to strangers, a locked front door is the worst failure. So a keyless
launch no longer refuses — it mints its own identity.

- **Fallback identity.** When discovery finds no usable external ed25519 key, the
  client generates an ed25519 keypair, stores the private key as PKCS8 PEM at
  `~/.config/terminal-mmo/id_ed25519` (mode `0600`, ADR 0015's config dir — *not*
  `~/.ssh`, to avoid colliding with the real `ssh`), and plays with it. This one
  fallback covers *every* cause of a failed discovery at once (no key, RSA-only,
  encrypted-file-without-agent, non-standard path), so we do **not** broaden the
  verifier to RSA/ecdsa or scan extra paths.
- **Identity anchor — the Save-safety guard.** Saves key off the public key, so a
  machine that resolves to a *different* key on a later launch silently loses
  progress. To prevent that, each successful login records an anchor in
  `config.json` (`identity.anchor = { publicKey, source: 'external' | 'generated' }`).
  Discovery resolves the anchored key *specifically*: a `generated` key is always
  available (we own the file); an `external` key that is momentarily unreachable
  (flaky agent + protected file) yields a **non-destructive refusal** — "run
  `ssh-add` and relaunch" — never a freshly minted key. Generation only happens
  when there is **no** anchor, i.e. for a machine that has never had an identity
  and therefore has no Save to lose.
- **Ordering:** anchored key → ssh-agent → `~/.ssh/id_ed25519` → generate. Real
  SSH keys still win on a first launch (developers keep their cross-machine
  identity), but once a key is generated it is sticky.
- **Transparency & degradation.** The generating launch prints one non-blocking
  line ("created a local game identity … keep this file to keep your character").
  If even the write fails (read-only home), we fall back to an *ephemeral*
  in-memory key and warn that progress won't persist — mirroring ADR 0015's
  "failed write degrades to in-memory for the session" rather than locking anyone
  out.
- **Consequence:** the old keyless refusal (`NO_KEY_HINT`) is retired — the only
  remaining client-side refusal is an anchored external key that is temporarily
  unreachable. We keep ADR 0004's "no passphrase prompt": a protected key without
  an agent is a recoverable relaunch, not a reason to decrypt the file ourselves.
