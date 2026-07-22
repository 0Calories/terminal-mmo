# terminal-mmo

A persistent PvE side-scrolling MMORPG played entirely in the terminal —
"MapleStory in a terminal," for developers.

Design docs are the source of truth. Read the material relevant to the area you
are changing: [`CONTEXT.md`](./CONTEXT.md) for domain language,
accepted [`docs/adr/`](./docs/adr/) for product scope and architecture decisions,
and [`CONTRIBUTING.md`](./CONTRIBUTING.md) for engineering conventions.

All game logic lives in `@mmo/core` as pure, deterministic functions so the
client and server cannot diverge. Run interactive TUI checks in a real terminal;
use `@opentui/core/testing` for headless checks. Run `bun run ci` before handing
off code changes.

## Code comments

Prefer self-explanatory code and names. Add a comment only when genuinely
confusing or surprising code still needs a one- or two-line explanation of why
it exists. Never narrate what the code already says or cite or restate ADRs in
code comments.

## Agent resources

- Issues and PRDs: [`docs/agents/issue-tracker.md`](./docs/agents/issue-tracker.md)
- Triage labels: [`docs/agents/triage-labels.md`](./docs/agents/triage-labels.md)
- Domain docs: [`docs/agents/domain.md`](./docs/agents/domain.md)
- Zone authoring: [`docs/agents/zone-authoring.md`](./docs/agents/zone-authoring.md)
