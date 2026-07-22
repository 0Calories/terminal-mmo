# Agent instructions

Design docs are the source of truth. Read the material relevant to the area you
are changing:

- [`CONTEXT.md`](./CONTEXT.md) for domain language
- [`docs/PRD.md`](./docs/PRD.md) for product scope
- [`docs/adr/`](./docs/adr/) for architecture decisions
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) for engineering conventions

Keep game logic pure and deterministic in `@mmo/core`. Use
`@opentui/core/testing` for automated TUI checks and a real terminal for
interactive checks. Run `bun run ci` before handing off code changes.

## Code comments

Prefer self-explanatory code and names. Add a comment only when genuinely
confusing or surprising code still needs a one- or two-line explanation of why
it exists. Never narrate what the code already says or cite or restate ADRs in
code comments.
