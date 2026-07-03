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
