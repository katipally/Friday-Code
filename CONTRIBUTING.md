# Contributing to Friday Code

Thanks for your interest in improving Friday! This guide covers local setup, the
development workflow, and how to get a change merged.

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.3 (the runtime, package manager, bundler, and test runner)
- Git
- Optional, for LSP grounding while testing: `typescript-language-server`, `pyright`,
  `gopls`, or `rust-analyzer` (auto-detected, skipped if absent)

## Setup

```bash
git clone https://github.com/katipally/friday-code.git
cd friday-code
bun install
bun run friday          # launch the TUI from source
```

## Project layout

A Bun workspace. The published `friday-code` binary bundles every package:

```
packages/
  shared/      types, theme + mode tokens, the engine↔UI event bus
  core/        engine: runners, agent loop, compaction, hooks, git, sessions, permissions
  providers/   zero-SDK provider wire adapters + model catalog
  tools/       built-in agent tools (file, bash, web, lsp, memory, tasks, worktree, …)
  mcp/         MCP client (stdio + streamable-http)
  lsp/         language-server client
  tui/         OpenTUI (Solid) interface + motion layer
  cli/         binary entry point
scripts/build.ts     compiles binaries + assembles the npm publish tree
packaging/           the published launcher package + Homebrew / Scoop templates
```

## Development workflow

Run these before opening a PR. CI runs the same checks:

```bash
bun run typecheck     # tsc --strict across every package
bun test              # the full suite
bun run check         # Biome lint + format
bun run ci            # all of the above (what CI runs)
```

Autofix formatting and safe lint issues:

```bash
bun run format
bunx biome check --write packages
```

## Code style

- **Biome** enforces formatting and linting (`biome.json`). Match the surrounding code.
- TypeScript runs in `strict` mode with `noUncheckedIndexedAccess`; non-null assertions
  (`x!`) on indexed access are idiomatic here.
- Double quotes, no semicolons, 2-space indent, ~120 col width. Biome handles all of it.
- Keep dependencies minimal; the engine is intentionally zero-SDK.

## Adding things

- **A tool**: implement it under `packages/tools/src/builtin/`, register it in
  `packages/tools/src/index.ts`, and handle its call in `packages/core/src/runner.ts`.
  Add a test under `packages/tools/test/` or `packages/core/test/`.
- **A provider**: most providers go through the OpenAI-compatible adapter in
  `packages/providers/src/`; add a registry entry. Anthropic and Google have dedicated
  adapters to follow as examples.

## Tests

Tests use `bun:test`. Keep them hermetic: set `FRIDAY_HOME` to a temp dir so they never
touch a real `~/.friday`. Prefer polling a condition over fixed sleeps for anything that
spawns subprocesses (see `packages/core/test/runtime-gaps.test.ts`).

## Pull requests

1. Branch off `main`.
2. Keep PRs focused; describe the change and how you verified it.
3. Ensure `bun run ci` is green.
4. Reference any related issue.

## Commit messages

Conventional, imperative summaries (`feat:`, `fix:`, `chore:`, `docs:`) with a short body
explaining the *why* when it isn't obvious.

## Reporting bugs / requesting features

Use the [issue templates](https://github.com/katipally/friday-code/issues/new/choose).
For security issues, follow [SECURITY.md](SECURITY.md) and do **not** open a public issue.

By contributing, you agree your contributions are licensed under the [MIT License](LICENSE).
