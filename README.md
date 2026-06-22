# friday

<div align="center">
<pre>
 █▀▀▀ █▀▀▄ ▀█▀ █▀▀▄ ▄▀▀▄ █ █
█▀▀  █▀▀▄  █  █  █ █▀▀█  █
▀    ▀  ▀ ▀▀▀ ▀▀▀  ▀  ▀  ▀
</pre>

⬡‿⬡ ready

a terminal AI coding agent, self-contained binary, OSS
</div>

[![CI](https://github.com/katipally/friday-code/actions/workflows/ci.yml/badge.svg)](https://github.com/katipally/friday-code/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/friday-code.svg)](https://www.npmjs.com/package/friday-code)
[![Bun 1.3+](https://img.shields.io/badge/Bun-1.3+-F9F1E1?logo=bun&logoColor=black)](https://bun.sh)
[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## What this is

A terminal-based AI coding agent. You type a task, it reads files, runs shell, edits the working tree, reports back. Self-contained binary, no Node at runtime, no system OpenGL. Bun 1.3+ for source build. The TUI is built on OpenTUI/Solid and has a mood-ring mascot in the status strip.

In the same family as [opencode](https://opencode.ai), [aider](https://aider.chat), and [cline](https://docs.cline.bot). Written from scratch in this repo, not a fork.

## Why this exists

The major paid coding tools (Claude Code, GitHub Copilot CLI, Cursor CLI, and a handful of others) ship a polished, well-designed feature set. The OSS CLI agent space is younger and ships most of it, but not all, and not always with the same depth.

friday is an attempt to ship a complete CLI coding agent in OSS, written from scratch, with the features the paid tools have. The approach is reverse engineering: study the design choices, understand why they work, implement them here. Not a fork, not a wrapper, not a thin re-skin. Same conceptual surface, independent implementation, MIT-licensed source. A contribution to the OSS community.

## Install

| Platform | Command | Notes |
|---|---|---|
| macOS / Linux (Homebrew) | `brew install katipally/tap/friday` | `friday` ends up in your brew prefix |
| Anywhere with npm | `npm i -g friday-code` | needs Node 18+. Launcher auto-detects arch + musl |
| macOS / Linux (curl) | `curl -fsSL https://raw.githubusercontent.com/katipally/friday-code/main/install.sh \| sh` | lands in `~/.friday/bin` |
| Windows (Scoop) | `scoop bucket add katipally https://github.com/katipally/scoop-bucket && scoop install friday` | updates with `scoop update friday` |
| Windows (npm) | `npm i -g friday-code` | PowerShell, CMD, or Git Bash |
| Source | `git clone … && cd friday-code && bun install && bun run friday` | Bun 1.3+ only |
| Docker | `FROM node:22-alpine && RUN npm i -g friday-code` | Alpine image picks the musl binary automatically |

Verify with `friday --version`. Direct binary downloads (with `SHASUMS256.txt`) are on the [Releases](https://github.com/katipally/friday-code/releases) page.

On first run, the splash shows up and `/model` lets you pick a provider. The picker validates the key against the provider before saving it, so a typo fails fast.

## Usage

```bash
friday                        # launch the interactive TUI
friday -c, --continue         # resume the most recent session
friday -s, --session <id>     # resume a specific session
friday run "<prompt>"         # headless: one turn, print result, exit
friday run "<prompt>" --json  # headless, emit JSON (for CI)
friday -v, --version
friday -h, --help
```

`friday run` is the CI mode: auto-approves tools, prints the model's response, exits. Pipe it, redirect it, wrap it in a GitHub Action.

| Key | Action |
|---|---|
| `Enter` | send message |
| `Shift+Enter` | newline in composer |
| `Shift+Tab` | cycle mode (plan → default → accept → yolo) |
| `Ctrl+B` | toggle context panel |
| `Ctrl+K` | command palette |
| `Ctrl+Y` | session history |
| `Ctrl+1-9` | jump between parallel sessions |
| `/` | slash command autocomplete |
| `@` | file or image mention |
| `?` or `F1` | full keymap |
| `Esc` | close overlay |
| `Esc Esc` | rewind last change |
| `Ctrl+C` | quit |

Mouse works too. Drag panel borders, click buttons, select to copy.

### Modes

Shift+Tab cycles. Each mode recolors the whole frame and gates every tool call.

| Glyph | Mode | What it does |
|---|---|---|
| `◐` | plan | read-only. Investigates, then shows a card with the full plan for you to review and run. |
| `◈` | default | asks before edits and commands. |
| `✎` | accept edits | auto-applies file edits. Asks for bash and network. |
| `⚡` | yolo | full auto. No prompts. |

### Mascot

`⬡‿⬡` lives above the composer. It changes expression: `⬡‿⬡` idle, `⬡⌄⬡` thinking, `[>‿<]` streaming, `⬡▰⬡` working, `\⬡‿⬡/` done, `⬡_⬡` error, `⬡⊙⬡` waiting. The mood also tints the color: green for done, red for error, amber for waiting, mode accent for everything else. You can tell what's happening from across the room.

## Features

What's actually in `main`, no aspirational claims.

**Engine.** Streaming everywhere, tool-calling loop, auto-compaction at ~80% (or `/compact`), 8 hook events (`PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SessionStart`, `SubagentStop`, `PreCompact`, `Notification`), sub-agents with custom Markdown agents in `~/.friday/agents/`, checkpoints + rewind (including files bash created), bash safety with allow/deny lists and risky-command detection, LSP grounding (typescript-language-server, pyright, gopls, rust-analyzer, auto-detected).

**Tools.** `read`, `write`, `edit`, `multiEdit`, `applyPatch`, `ls`, `glob`, `grep`, `bash`, `webfetch`, `websearch`, `askUser`, `skill`, `task` (read-only sub-agent), `task_create` / `task_list` / `task_status` / `task_stop`, `spawn_agents` (swarm) / `spawn_team` + `board_*` (coordinated team), `todo_write`, `exit_plan`, `lsp_hover` / `lsp_definition` / `lsp_symbols`, `tool_search`, `memory`, `notebook_edit`, `cron_create` / `cron_list` / `cron_delete`, `enter_worktree` / `exit_worktree` / `worktree_list`, opt-in `browser_*` and `computer_*`. MCP client (stdio + streamable-http).

**TUI.** Animated mascot (7 states, defined in `packages/shared/src/mascot.ts`), animated FRIDAY wordmark drawn from half-block subpixels in the TUI itself, 4-mode visual system with per-mode glyph + accent, responsive layout with auto-collapsing panels, motion layer with `FRIDAY_REDUCED_MOTION=1` accessibility fallback, multi-session tabs, context panel with plans/todos/files/context/tasks/MCP tabs, dashboard (Sessions · Teams · Swarm · History, Ctrl+O), on-device speech-to-text mic with input-device select + live transcription (Ctrl+R), command palette, slash command + `@` mention autocomplete, markdown skills in `~/.friday/skills/`.

**Providers (19).** Anthropic and Google Gemini ship dedicated adapters. 17 more (OpenAI, OpenRouter, OpenCode Zen, Groq, Moonshot/Kimi, DeepSeek, xAI, Mistral, Perplexity, Together, Cerebras, DeepInfra, Fireworks, Azure OpenAI, MiniMax, Ollama, llama.cpp / LM Studio) go through one OpenAI-compat adapter. Ollama and llama.cpp are keyless. Model catalog from [models.dev](https://models.dev) with an offline snapshot fallback. Reasoning effort via `/effort` slider.

**Headless / CI.** `friday run "<prompt>" [--json]`, `-c` continue, `-s <id>` resume. Idempotent publish script: if a `package@version` is already on npm, it's skipped.

## Configuration

Everything under `~/.friday/` (override with `FRIDAY_HOME`):

```
auth.json     provider keys (written 0600 by the /model modal)
config.json   model, effort, mode, mcp, hooks, bash allow/deny
memory/       user-level persistent memory
skills/       user-level markdown skills
sessions/     bun:sqlite session state
logs/         when something goes wrong, look here
```

API keys can also come from env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, etc.). Env wins on conflict.

```json
{
  "model": "anthropic/claude-sonnet-4.5",
  "effort": "medium",
  "mode": "default",
  "mcp": {
    "my-server": { "type": "stdio", "command": ["my-mcp-server"] },
    "remote":    { "type": "http",  "url": "https://example.com/mcp" }
  },
  "hooks": {
    "PreToolUse":  [{ "matcher": "bash", "command": "./gate.sh" }],
    "PostToolUse": [{ "matcher": "write|edit", "command": "prettier --write ." }]
  },
  "bash": { "deny": ["rm -rf", "git push"], "allow": ["npm test", "ls"] }
}
```

For project context that ships with the repo, drop a `FRIDAY.md` in the project root. Symlink your existing `AGENTS.md` if you have one. Friday reads both at the start of every session.

## Develop

Bun 1.3+.

```bash
git clone https://github.com/katipally/friday-code.git
cd friday-code
bun install
bun run friday
bun run ci    # typecheck + tests + biome, what CI runs
```

Optional, for LSP grounding while testing: `typescript-language-server`, `pyright`, `gopls`, or `rust-analyzer`. Auto-detected, skipped if absent.

To add a tool: implement in `packages/tools/src/builtin/`, register in `packages/tools/src/index.ts`, handle the call in `packages/core/src/runner.ts`. To add a provider: most go through the OpenAI-compat adapter in `packages/providers/src/`. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow.

## Releases

`git tag v2.0.7 && git push origin v2.0.7` is the whole release. Versions are derived from the tag, nothing in source is hardcoded. The pipeline:

1. 8 builds run in parallel on native runners (5 stable, 2 musl, 1 best-effort Windows ARM)
2. GitHub Release with all binaries + `SHASUMS256.txt`
3. Manual approval in the `release` environment (nothing goes to npm until you click)
4. 9 npm packages publish with provenance (8 platform + 1 launcher)
5. Homebrew + Scoop PRs open on the tap and bucket repos

If a stable build fails, the release is blocked. If a musl or Windows ARM build fails, the release still proceeds. The publish script is idempotent: re-run and already-shipped packages are skipped.

## Roadmap

**Shipped.** 4 permission modes with per-mode glyph + accent. 7-state animated mascot in TUI. Animated FRIDAY wordmark in TUI. 8 native binaries + 9 npm packages with launcher auto-resolve. 19 built-in providers (Anthropic, Gemini, OpenAI-compat for 17 more). 8 hook events. Sub-agents (read-only `task`), swarms (`spawn_agents`) and coordinated teams (`spawn_team` + shared board), each opening in its own terminal window. Dashboard over sessions/teams/swarm/history (Ctrl+O). On-device speech-to-text mic with input-device select + live transcription (Ctrl+R). Auto-compaction + manual `/compact`. Checkpoints + rewind (bash file snapshotting). LSP grounding (4 languages). MCP client. Background tasks, cron, worktree. Opt-in browser + computer-use control. Headless mode with JSON output. `FRIDAY.md` / `AGENTS.md` project context. Slash command + `@` mention autocomplete.

**In progress.** Custom agents via Markdown frontmatter (loader works, picker is not done). Windows ARM64 build (best-effort, smoke tested only). Session export/import.

**Not yet.** Desktop app, IDE extension (VS Code / JetBrains), web interface, iOS / mobile, cloud-managed scheduled tasks, channel integrations (Slack / Discord / Telegram), JSON / SDK-defined custom agents, plugin system, ACP (Agent Client Protocol) for IDE handoff. These would need a separate initiative. The fastest way to get any of them is to send a PR.

## Troubleshooting

`⬡_⬡` hmm.

- **`friday: command not found`.** npm: check `npm config get prefix` and the bin dir. curl installer: the install script prints an `export PATH=...` line, add it to your shell rc. Homebrew: `/opt/homebrew/bin` should be on PATH (Apple Silicon). Scoop: `scoop bucket known` should list `katipally`. Quick check: `which friday`.
- **TUI looks broken or colors are wrong.** You need a truecolor terminal (iTerm2, Alacritty, Kitty, WezTerm, Ghostty, GNOME Terminal, Windows Terminal, VS Code integrated terminal). Set `COLORTERM=truecolor` if needed. For less animation, `FRIDAY_REDUCED_MOTION=1`.
- **Mouse doesn't work.** Most terminals enable it by default. tmux needs `set -g mouse on` (tmux 3.0+).
- **npm install fails on Windows.** PowerShell execution policy. Run as Administrator: `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`. Or use Scoop.
- **Provider rejected the key.** The picker validates before saving. If you see "invalid key" after paste, the full key didn't copy. The picker shows the last 4 chars after paste for sanity check. If validation passes but auth errors later, check the env var and `~/.friday/auth.json`.
- **macOS Gatekeeper.** The binary isn't signed. Right-click → Open → confirm. Or `xattr -d com.apple.quarantine $(which friday)`.
- **Windows SmartScreen.** Click "More info" → "Run anyway". Or use Scoop.
- **Something else.** `~/.friday/logs/`. If logs don't help, open an issue with `friday --version` and the relevant log lines.

## Contributing, security, license

- [CONTRIBUTING.md](CONTRIBUTING.md) for setup, tests, and PR workflow.
- [SECURITY.md](SECURITY.md) for private vulnerability reports and the security model.
- [CHANGELOG.md](CHANGELOG.md) for per-release notes.
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
- [LICENSE](LICENSE). MIT.
