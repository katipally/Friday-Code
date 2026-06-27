# friday

<div align="center">
<pre>
 █▀▀▀ █▀▀▄ ▀█▀ █▀▀▄ ▄▀▀▄ █ █
█▀▀  █▀▀▄  █  █  █ █▀▀█  █
▀    ▀  ▀ ▀▀▀ ▀▀▀  ▀  ▀  ▀
</pre>

⬡‿⬡ ready

a terminal AI coding agent, self-contained binary, open source

[![CI](https://github.com/katipally/friday-code/actions/workflows/ci.yml/badge.svg)](https://github.com/katipally/friday-code/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/friday-code.svg)](https://www.npmjs.com/package/friday-code)
[![npm downloads](https://img.shields.io/npm/dm/friday-code.svg)](https://www.npmjs.com/package/friday-code)
[![Bun 1.3+](https://img.shields.io/badge/Bun-1.3+-F9F1E1?logo=bun&logoColor=black)](https://bun.sh)
[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

## What this is

A terminal AI coding agent. You type a task, it reads files, runs shell, edits the working tree, and reports back. It installs as a self-contained binary, with no Node at runtime and no system OpenGL; building from source needs Bun 1.3+. The TUI is built on OpenTUI/Solid and has a mood-ring mascot in the status strip.

It sits in the same family as [opencode](https://opencode.ai), [aider](https://aider.chat), and [cline](https://docs.cline.bot). Written from scratch in this repo, not a fork.

## Why this exists

The major paid coding tools (Claude Code, GitHub Copilot CLI, Cursor CLI, and a few others) ship a polished, well-designed feature set. The open-source CLI agent space is younger and covers most of it, though not all of it and not always as deeply.

friday is an attempt to ship a complete CLI coding agent as open source, written from scratch, with the features the paid tools have. The method is reverse engineering: study a design choice, work out why it works, then build it here. The source is MIT-licensed and the implementation is independent.

## Install

Pick your OS. Each command installs the `friday` binary and puts it on your PATH.

**Homebrew (macOS / Linux, recommended)**

```sh
brew tap katipally/tap
brew trust katipally/tap   # one-time: recent Homebrew requires trusting third-party taps
brew install friday
```

Later: `brew upgrade friday`. Apple Silicon, Intel, and Linux x64/arm64 are all covered.

> The `brew trust` step is a one-time, per-machine Homebrew prompt for any
> third-party tap, not something specific to friday. Skip it and `brew install`
> errors with "Refusing to load formula … from untrusted tap."

**Scoop (Windows, recommended)**

```powershell
scoop bucket add katipally https://github.com/katipally/scoop-bucket
scoop install friday
```

Later: `scoop update friday`.

**npm (any OS with Node 18+)**

```sh
npm install -g friday-code
```

The `friday-code` launcher detects your platform (including Linux musl vs glibc) and pulls the matching binary. Later: `npm update -g friday-code`, or run `/update` inside friday.

**Shell script (macOS / Linux, no package manager)**

```sh
curl -fsSL https://raw.githubusercontent.com/katipally/friday-code/main/install.sh | sh
```

It lands in `~/.friday/bin` and prints the `export PATH=…` line to add to your shell rc.

**Other ways**

- **Direct download:** grab the binary for your platform from the [Releases](https://github.com/katipally/friday-code/releases) page (`friday-<os>-<arch>`), verify it against `SHASUMS256.txt`, `chmod +x`, and run.
- **Docker / Alpine:** `RUN npm i -g friday-code`. The musl binary is selected automatically.
- **From source:** `git clone https://github.com/katipally/friday-code && cd friday-code && bun install && bun run friday` (needs Bun 1.3+).

Verify any install with `friday --version`. friday checks for new versions on its own and offers to update from inside the app.

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

`friday run` is the CI mode: it auto-approves tools, prints the model's response, and exits. Pipe it, redirect it, or wrap it in a GitHub Action.

| Key | Action |
|---|---|
| `Enter` | send message |
| `Shift+Enter` | newline in composer |
| `Shift+Tab` | cycle mode (plan → default → yolo) |
| `Ctrl+B` | toggle context panel |
| `Ctrl+Space` | steer the running agent and add context |
| `Ctrl+Y` | session history |
| `/` | slash command autocomplete |
| `@` | file or image mention |
| `?` or `F1` | full guide: slash commands, keyboard, modes |
| `Esc` | close overlay |
| `Esc Esc` | rewind last change |
| `Ctrl+C` | quit (press twice to confirm) |

Mouse works too: drag panel borders, click buttons, select to copy.

### Modes

Shift+Tab cycles. Each mode recolors the whole frame and gates every tool call.

| Glyph | Mode | What it does |
|---|---|---|
| `◐` | plan | read-only. Investigates, then shows a card with the full plan for you to review and run. |
| `◈` | default | asks before edits and commands. |
| `⚡` | yolo | full auto, no prompts. |

### Mascot

`⬡‿⬡` sits above the composer and changes expression with state: `⬡‿⬡` idle, `⬡⌄⬡` thinking, `[>‿<]` streaming, `⬡▰⬡` working, `\⬡‿⬡/` done, `⬡_⬡` error, `⬡⊙⬡` waiting. The color follows the mood: green for done, red for error, amber for waiting, mode accent for everything else.

### Steer

Agents go wrong when they guess at something you knew and then build on the guess. `/steer` is how you catch it mid-flight. Type `/steer` (or press Ctrl+Space) while friday is working; it soft-interrupts the current generation and opens a composer. Write what it missed, press Enter, and your note folds in so the agent course-corrects right away.

```
/steer
→ "we are keeping the old auth API, do not rewrite it"
```

Full reference, including the cost model and the composer's `@file` mentions, is in [docs/steer.md](docs/steer.md). Every slash command is listed in [docs/commands.md](docs/commands.md).

## Features

What's in `main` today.

**Engine.** Streaming everywhere, a tool-calling loop, auto-compaction at ~80% (or `/compact`), 8 hook events (`PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SessionStart`, `SubagentStop`, `PreCompact`, `Notification`), read-only sub-agents, checkpoints and rewind (including files bash created), bash safety with allow/deny lists and risky-command detection, and LSP grounding (typescript-language-server, pyright, gopls, rust-analyzer, auto-detected).

**Tools.** `read`, `write`, `edit`, `multiEdit`, `applyPatch`, `ls`, `glob`, `grep`, `bash`, `webfetch`, `websearch`, `askUser`, `skill`, `delegate` / `task` (read-only sub-agent), `task_create` / `task_list` / `task_status` / `task_stop` / `send_to_task`, `todo_write`, `exit_plan`, `lsp_hover` / `lsp_definition` / `lsp_symbols`, `tool_search`, `memory`, `notebook_edit`, `cron_create` / `cron_list` / `cron_delete`, `enter_worktree` / `exit_worktree` / `worktree_list`, plus opt-in `browser_*` and `computer_*`. MCP client over stdio and streamable-http.

**TUI.** Animated mascot (7 states, defined in `packages/shared/src/mascot.ts`), an animated FRIDAY wordmark drawn from half-block subpixels in the TUI itself, a 3-mode visual system with per-mode glyph and accent, responsive layout with auto-collapsing panels, a motion layer with a `FRIDAY_REDUCED_MOTION=1` accessibility fallback, a context panel for plans/todos/files/context with separate MCP and skills surfaces, an on-device speech-to-text mic with input-device select and live transcription (Ctrl+R), inline slash command and `@` mention autocomplete, and markdown skills in `~/.friday/skills/`.

**Providers (19).** Anthropic and Google Gemini ship dedicated adapters. 17 more (OpenAI, OpenRouter, OpenCode Zen, Groq, Moonshot/Kimi, DeepSeek, xAI, Mistral, Perplexity, Together, Cerebras, DeepInfra, Fireworks, Azure OpenAI, MiniMax, Ollama, llama.cpp / LM Studio) go through one OpenAI-compatible adapter. Ollama and llama.cpp are keyless. The model catalog comes from [models.dev](https://models.dev) with an offline snapshot fallback. Reasoning effort is set with the `/effort` slider.

**Headless / CI.** `friday run "<prompt>" [--json]`, `-c` to continue, `-s <id>` to resume. The publish script is idempotent: if a `package@version` is already on npm, it's skipped.

## Configuration

Everything lives under `~/.friday/` (override with `FRIDAY_HOME`):

```
auth.json     provider keys (written 0600 by the /model modal)
config.json   model, effort, mode, mcp, hooks, bash allow/deny
memory/       user-level persistent memory
skills/       user-level markdown skills
sessions/     bun:sqlite session state
logs/         when something goes wrong, look here
```

API keys can also come from env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, and so on). Env wins on conflict.

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

For project context that ships with the repo, drop a `FRIDAY.md` in the project root. Symlink your existing `AGENTS.md` if you have one. friday reads both at the start of every session.

## Develop

Bun 1.3+.

```bash
git clone https://github.com/katipally/friday-code.git
cd friday-code
bun install
bun run friday
bun run ci    # typecheck + tests + biome, what CI runs
```

For LSP grounding while testing, install `typescript-language-server`, `pyright`, `gopls`, or `rust-analyzer`. They're auto-detected and skipped if absent.

To add a tool: implement it in `packages/tools/src/builtin/`, register it in `packages/tools/src/index.ts`, and handle the call in `packages/core/src/runner.ts`. To add a provider: most go through the OpenAI-compatible adapter in `packages/providers/src/`. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow.

## Releases

`git tag v2.0.15 && git push origin v2.0.15` is the whole release. Versions are derived from the tag; nothing in source is hardcoded. The pipeline:

1. 8 builds run in parallel on native runners (5 stable, 2 musl, 1 best-effort Windows ARM).
2. A GitHub Release is created with all binaries and `SHASUMS256.txt`.
3. A manual approval in the `release` environment gates npm (nothing publishes until you click).
4. 9 npm packages publish with provenance (8 platform packages plus the launcher).
5. The Homebrew tap and Scoop bucket get the new version committed automatically.

If a stable build fails, the release is blocked. If a musl or Windows ARM build fails, the release still proceeds. The publish script is idempotent: re-run it and already-shipped packages are skipped.

## Roadmap

**Shipped.** 3 permission modes with per-mode glyph and accent. 7-state animated mascot in the TUI. Animated FRIDAY wordmark. 8 native binaries and 9 npm packages with launcher auto-resolve. 19 built-in providers (Anthropic, Gemini, and an OpenAI-compatible adapter for 17 more). 8 hook events. Read-only sub-agents (`delegate` / `task`). On-device speech-to-text mic with input-device select and live transcription (Ctrl+R). Auto-compaction and manual `/compact`. Checkpoints and rewind with bash file snapshotting. LSP grounding for 4 languages. MCP client. Background tasks, cron, worktree. Opt-in browser and computer-use control. Headless mode with JSON output. `FRIDAY.md` / `AGENTS.md` project context. Slash command and `@` mention autocomplete.

**Not yet.** Desktop app, IDE extension (VS Code / JetBrains), web interface, iOS / mobile, cloud-managed scheduled tasks, channel integrations (Slack / Discord / Telegram), plugin system, and ACP (Agent Client Protocol) for IDE handoff. Each would need its own initiative. The fastest way to get one is to send a PR.

## Troubleshooting

- **`friday: command not found`.** npm: check `npm config get prefix` and the bin dir. curl installer: add the `export PATH=...` line it printed to your shell rc. Homebrew: `/opt/homebrew/bin` should be on PATH (Apple Silicon). Scoop: `scoop bucket known` should list `katipally`. Quick check: `which friday`.
- **TUI looks broken or colors are wrong.** You need a truecolor terminal (iTerm2, Alacritty, Kitty, WezTerm, Ghostty, GNOME Terminal, Windows Terminal, VS Code integrated terminal). Set `COLORTERM=truecolor` if needed. For less animation, set `FRIDAY_REDUCED_MOTION=1`.
- **Mouse doesn't work.** Most terminals enable it by default. tmux needs `set -g mouse on` (tmux 3.0+).
- **npm install fails on Windows.** Usually the PowerShell execution policy. Run as Administrator: `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`. Or use Scoop.
- **Provider rejected the key.** The picker validates before saving. If you see "invalid key" after paste, the full key probably didn't copy; the picker shows the last 4 chars after paste so you can sanity-check. If validation passes but auth errors later, check the env var and `~/.friday/auth.json`.
- **macOS Gatekeeper.** The binary isn't signed. Right-click, Open, confirm. Or run `xattr -d com.apple.quarantine $(which friday)`.
- **Windows SmartScreen.** Click "More info", then "Run anyway". Or use Scoop.
- **Something else.** Check `~/.friday/logs/`. If the logs don't help, open an issue with `friday --version` and the relevant log lines.

## Documentation

Deep dives on every feature live in [docs/](docs/index.md):

- [Slash commands](docs/commands.md): every command you can type.
- [Steer](docs/steer.md): `/steer`.
- [Configuration](docs/configuration.md): `~/.friday/`, keys, hooks, project context, skills, and commands.
- [Providers](docs/providers.md): the 19 providers and reasoning effort.
- [Tools](docs/tools.md): the capabilities the model calls.
- [Integrations](docs/integrations.md): browser, computer use, voice, LSP, headless mode.

## Contributing, security, license

- [CONTRIBUTING.md](CONTRIBUTING.md) for setup, tests, and the PR workflow.
- [SECURITY.md](SECURITY.md) for private vulnerability reports and the security model.
- [CHANGELOG.md](CHANGELOG.md) for per-release notes.
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
- [LICENSE](LICENSE). MIT.
</content>
</invoke>
