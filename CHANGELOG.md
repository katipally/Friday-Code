# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] — 2026-06-18

First public, open-source release of the rewritten Friday Code — a terminal AI coding agent
built on OpenTUI (Solid) with a hand-rolled, zero-SDK multi-provider engine.

> Note: this `2.0.0` supersedes an unrelated earlier `1.x` line that shipped under the same npm
> name. It is a fresh codebase; treat it as the first stable release.

### Added

- Animated, mouse-first TUI with a mascot, modes (`plan`/`default`/`accept-edit`/`yolo`), and a
  responsive layout.
- Agentic loop with streaming, tool-calling, human-in-the-loop approval, and context
  auto-compaction.
- Multi-provider engine (Anthropic, Google Gemini, and an OpenAI-compatible adapter covering
  OpenAI, OpenRouter, Groq, DeepSeek, xAI, Together, Ollama, and more) with prompt caching and a
  models.dev catalog snapshot.
- Tools: file read/write/edit/multi-edit/apply-patch, ls/glob/grep, bash, web fetch/search,
  ask_user, skills, sub-agent tasks, todos, memory, notebook editing, tool search, LSP
  (hover/definition/symbols), background tasks, cron schedules, and git worktrees.
- Sessions with `bun:sqlite` persistence, parallel background sessions, checkpoints/rewind/redo,
  and resume (`-s` / `-c`).
- LSP grounding, Claude-Code-parity hooks, MCP client (stdio + streamable-HTTP), and `/commit`.
- Self-contained binaries for macOS (arm64/x64), Linux (x64/arm64), and Windows (x64), distributed
  via npm, Homebrew, Scoop, a curl installer, and GitHub Releases.
- `friday --version` / `friday --help`.

### Security

- Compiled binaries are built with `--no-compile-autoload-bunfig`, so they don't read or execute
  `preload` scripts from a working-directory `bunfig.toml`.

[2.0.0]: https://github.com/katipally/friday-code/releases/tag/v2.0.0
