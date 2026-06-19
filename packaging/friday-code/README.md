# friday-code

A self-contained terminal AI coding agent. Type a task, friday reads files, runs shell, edits the working tree, reports back. Bun 1.3+ for source build, no runtime dependencies when installed from a binary.

## Install

```bash
npm i -g friday-code
```

The `friday-code` package is a thin launcher. It detects your platform and architecture at install time and pulls in the matching prebuilt binary as an optional dependency. After install, `friday` is on your `PATH`.

| Platform | Resolved package |
|---|---|
| macOS Apple Silicon | `friday-code-darwin-arm64` |
| macOS Intel | `friday-code-darwin-x64` |
| Linux x64 (glibc) | `friday-code-linux-x64` |
| Linux arm64 (glibc) | `friday-code-linux-arm64` |
| Linux x64 (musl, Alpine, Docker) | `friday-code-linux-x64-musl` |
| Linux arm64 (musl, Alpine, Docker) | `friday-code-linux-arm64-musl` |
| Windows x64 | `friday-code-windows-x64` |
| Windows arm64 | `friday-code-windows-arm64` |

On Alpine (or any musl libc) the launcher reads `/lib/ld-musl-*` and picks the right musl binary automatically. No env var to set.

## Usage

```bash
friday                        # launch the interactive TUI
friday -c, --continue         # resume the most recent session
friday -s, --session <id>     # resume a specific session by id
friday run "<prompt>"         # headless: one turn, print the result, exit
friday run "<prompt>" --json  # headless, emit JSON
friday -v, --version
friday -h, --help
```

On first run, onboarding shows up and `/model` lets you pick a provider. The picker validates the key against the provider before saving it, so a typo fails fast.

## Features

- 8 native binary builds (5 stable + 2 musl + 1 best-effort Windows ARM)
- 19 built-in providers (Anthropic, Google Gemini, OpenAI-compat for 17 more including OpenRouter, Groq, DeepSeek, Moonshot/Kimi, xAI, Mistral, Perplexity, Together, Cerebras, DeepInfra, Fireworks, Azure OpenAI, MiniMax, OpenCode Zen, Ollama, llama.cpp)
- 4 permission modes (plan, default, accept-edits, yolo) with per-mode glyph and accent
- 7-state animated mascot in the TUI status strip
- 8 hook events (PreToolUse, PostToolUse, UserPromptSubmit, Stop, SessionStart, SubagentStop, PreCompact, Notification)
- Checkpoints + rewind including files created by bash
- Background tasks, cron schedules, git worktree isolation
- MCP client (stdio + streamable-http)
- LSP grounding (typescript-language-server, pyright, gopls, rust-analyzer, auto-detected)
- Sub-agents with custom Markdown agents
- Auto-compaction at ~80% or manual `/compact`
- Headless mode for CI with JSON output
- `FRIDAY.md` / `AGENTS.md` project context

## Why this exists

The major paid coding tools (Claude Code, GitHub Copilot CLI, Cursor CLI, and a handful of others) ship a polished, well-designed feature set. The OSS CLI agent space is younger and ships most of it, but not all, and not always with the same depth.

friday is an attempt to ship a complete CLI coding agent in OSS, written from scratch, with the features the paid tools have. The approach is reverse engineering: study the design choices, understand why they work, implement them here. Not a fork, not a wrapper, not a thin re-skin. Same conceptual surface, independent implementation, MIT-licensed source. A contribution to the OSS community.

## Documentation

Full documentation, source, and issue tracker live in the GitHub repository:

- Source: https://github.com/katipally/friday-code
- README: https://github.com/katipally/friday-code#readme
- Releases (with SHASUMS256.txt): https://github.com/katipally/friday-code/releases
- Issues: https://github.com/katipally/friday-code/issues

## License

MIT. See [LICENSE](https://github.com/katipally/friday-code/blob/main/LICENSE).
