# Changelog

All notable changes to Friday Code will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-03-30

### Fixed

- Fixed npm bin entry path format (removed `./` prefix) to resolve `command not found` on global install

## [1.0.0] - 2026-03-30

### Added

- Terminal UI built with React (Ink) — timeline view, collapsible runs, viewport-aware rendering
- Agent engine with Vercel AI SDK `streamText` and multi-step tool loops (up to 25 steps)
- 13 built-in tools: file read/write/edit, directory listing, glob search, content search, shell execution, git operations, web fetch, test runner
- Three AI providers: OpenAI, Anthropic, and Ollama (local models)
- Live model fetching from provider APIs
- Streaming responses with real-time text and reasoning display
- Tool approval system for destructive operations (write, edit, execute, commit)
- Slash commands: `/help`, `/model`, `/provider`, `/scope`, `/config`, `/clear`, `/new`, `/history`, `/exit`
- File mentions with `@filename` for inline context injection
- Input autocomplete for commands and file paths
- SQLite database with Drizzle ORM for conversations, settings, and model cache
- Input history with arrow key navigation
- `/config` command for runtime settings (maxSteps, approval mode)
- Error retry with `r` key
- Collapsed past runs for viewport optimization
- Ollama reasoning model support via `<think>` tag extraction
