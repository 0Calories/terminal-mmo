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
