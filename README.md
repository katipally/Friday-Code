# Friday Code

A new kind of terminal AI coding agent — built on [OpenTUI](https://opentui.com) (Solid),
with a hand-rolled, dependency-light multi-provider engine.

> Rounded, animated, mouse-first. Dark-grey theme with mode-colored accents. A cute hyperactive
> mascot named **Friday** lives above your composer and reacts to what the agent is doing.

## Status

Early development — built in milestones (see `~/.claude/plans/`). Currently: **M0 — animated shell**.

## Develop

```bash
bun install
bun run friday        # launch the TUI
bun test              # engine tests
```

Requires [Bun](https://bun.sh) ≥ 1.3.

## Packages

| Package | Purpose |
|---------|---------|
| `@friday/shared`    | shared types, theme + mode tokens, engine↔UI bus contract |
| `@friday/core`      | engine: agent loop, sessions, modes, permissions, config |
| `@friday/providers` | zero-SDK provider wire adapters + model catalog |
| `@friday/tools`     | built-in agent tools |
| `@friday/mcp`       | MCP client |
| `@friday/tui`       | OpenTUI (Solid) interface |
| `@friday/cli`       | binary entry point |
