# terminal-mmo

A persistent PvE side-scrolling MMORPG played entirely in the terminal —
"MapleStory in a terminal," for developers.

> **Design docs are the source of truth.** Read before working in an area:
> [`CONTEXT.md`](./CONTEXT.md) (domain glossary) ·
> [`docs/PRD.md`](./docs/PRD.md) (problem/scope/milestones) ·
> [`docs/adr/`](./docs/adr/) (architecture decisions).

All game logic lives in `@mmo/shared` as pure, deterministic functions so the
client and (M2) server can never diverge. Run interactive TUI checks in a real
terminal; use `@opentui/core/testing` for headless/automated checks.

## Agent skills

### Issue tracker

Issues and PRDs live as GitHub issues on `0Calories/terminal-mmo` (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
