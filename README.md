# Friday Code

[![CI](https://github.com/katipally/friday-code/actions/workflows/ci.yml/badge.svg)](https://github.com/katipally/friday-code/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/friday-code.svg)](https://www.npmjs.com/package/friday-code)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A new kind of terminal AI coding agent — built on [OpenTUI](https://opentui.com) (Solid),
with a hand-rolled, dependency-light multi-provider engine.

> Rounded, animated, mouse-first. Neutral near-black theme with mode-colored accents. A cute,
> expressive mascot named **Friday** lives above your composer — it blinks, glances, celebrates on
> success and shakes on errors, with a mood tint that follows the current mode and effort.

## Install

Friday ships as a **self-contained binary** — no Bun, Node, or other runtime required.

```bash
# curl (macOS / Linux)
curl -fsSL https://raw.githubusercontent.com/katipally/friday-code/main/install.sh | sh

# npm (any platform with Node/npm)
npm install -g friday-code

# Homebrew (macOS / Linux)
brew install katipally/tap/friday

# Scoop (Windows)
scoop bucket add katipally https://github.com/katipally/scoop-bucket
scoop install friday
```

Or grab a binary for your platform directly from
[Releases](https://github.com/katipally/friday-code/releases).

Then run:

```bash
friday
```

On first run, a short **onboarding** appears, then the `/model` connector — pick a provider, paste a
key (it's **validated** against the provider before it's saved, so a bad key is caught early), then
choose a model. Then just talk to Friday.

> **Supported platforms:** macOS (arm64/x64), Linux (x64/arm64), Windows (x64). Best in a
> truecolor terminal with mouse support — iTerm2, Alacritty, Kitty, WezTerm, GNOME Terminal,
> Windows Terminal, or the VS Code integrated terminal.

## Features

- **Agentic loop** — streaming, tool-calling, human-in-the-loop, multi-step until done, with
  **context auto-compaction** (~80% of the window, or `/compact`) so long sessions never wall out.
- **Live todos** — the agent maintains a task list (`todo_write`) shown in the right panel.
- **Parallel background sessions** — each session runs its own loop concurrently; switch freely while
  others keep working and **notify** you when they finish or need input.
- **Background tasks & schedules** — spawn detached agents (`task_*`) and recurring jobs (`cron_*`).
- **Git worktrees** — isolate risky/parallel work in a worktree (`enter_worktree` / `exit_worktree`).
- **Checkpoints & rewind** — every turn snapshots files (incl. bash-created); rewind code, the
  conversation, or both, with redo.
- **Persistent memory** — durable facts (`memory`) stored under `~/.friday/memory` and surfaced
  back into the system prompt across sessions.
- **LSP grounding** — after every edit, real compiler diagnostics are fed back so the model
  self-corrects; `lsp_hover` / `lsp_definition` / `lsp_symbols` tools and `@Symbol` mentions
  (typescript-language-server, pyright, gopls, rust-analyzer — auto-detected, skipped if absent).
- **Hooks** — Claude-Code-parity lifecycle hooks (PreToolUse/PostToolUse/UserPromptSubmit/Stop/
  SessionStart/SubagentStop/PreCompact/Notification) with matchers and a JSON stdin/stdout contract.
- **Git** — branch + diffstat in the panel; `/commit` drafts a message from the diff for you to
  edit/approve, then commits (local-only).
- **Images** — `@image.png` mentions attach as vision input to multimodal models.
- **Prompt caching** — Anthropic system/tools cached; OpenAI/Gemini prefix caching — cheaper repeats.
- **Cost meter** — live tokens + $ + a context-window gauge.
- **Providers (zero-SDK)** — one OpenAI-compatible adapter (OpenAI, OpenRouter, Groq, Kimi/Moonshot,
  MiniMax, DeepSeek, xAI, OpenCode Zen, Together, Ollama, llama.cpp), plus **Anthropic** and
  **Google Gemini**. Model catalog from [models.dev](https://models.dev) with an offline snapshot.
- **Modes** — `plan` / `default` / `accept-edit` / `yolo`, cycled with **Shift+Tab** (icons ◐ ◈ ✎ ⚡).
  Per-mode permission posture, plus bash allow/deny lists and risky-command warnings.
- **Plan-mode approval gate** — in `plan` mode Friday investigates read-only and proposes a plan; a
  card then shows the **full plan** and lets you run it in `default` / `accept-edit` / `yolo`, keep
  planning, or give custom input. Every plan is saved to the right panel's **plans** section to re-open.
- **Reasoning effort** — `/effort` (or click the `◇ effort` badge) opens a slider; the levels offered
  are capped to what the model supports (OpenAI → low/med/high · Anthropic/Google → up to max).
- **Responsive layout** — side panels auto-collapse as the terminal narrows so the chat keeps focus;
  on small terminals an opened panel takes the full screen, and closing it returns you to the chat.
- **Tools** — read, write, edit, multi-edit, apply-patch, ls, glob, grep, bash, webfetch, websearch,
  ask_user, skill, task, todo_write, memory, notebook_edit, tool_search, lsp_*, task/cron/worktree.
- **Sessions** — multi-session tabs, `bun:sqlite` persistence, `Ctrl+1-9` to switch, clean-exit
  screen, resume with `friday -s <id>` or `friday -c`.
- **Commands & context** — slash commands + `Ctrl+K` palette, `/`+`@` autocomplete, `@file` mentions,
  FRIDAY.md / AGENTS.md project context, markdown skills (`.friday/skills`).
- **MCP** — connect stdio or streamable-HTTP MCP servers; their tools merge into the registry.
- **Animated, mouse-first** — a real motion layer (easing, modal pop-ins, accordions, item reveals)
  with a `FRIDAY_REDUCED_MOTION=1` fallback; click panels/tabs/cards, drag borders, copy-on-select.

## Usage

```bash
friday                      # launch the interactive TUI
friday -c, --continue       # resume the most recent session
friday -s, --session <id>   # resume a specific session
friday run "<prompt>"       # headless: run one turn, print the result, exit
friday run "<prompt>" --json  # headless, emit JSON
friday -v, --version
friday -h, --help
```

## Configuration

Everything lives under `~/.friday/` (override with `FRIDAY_HOME`):

- `auth.json` — provider keys (managed by the `/model` modal; written `0600`). API keys can also be
  supplied via environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …).
- `config.json` — selected model/effort/mode, plus optional `mcp`, `hooks`, and `bash` blocks:
  ```json
  {
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
- `skills/`, `commands/`, `memory/` — user-level markdown skills, slash commands, and persisted
  memory. Project-level skills/commands live in `.friday/skills` and `.friday/commands`.

## Develop

Requires [Bun](https://bun.sh) ≥ 1.3.

```bash
bun install
bun run friday          # launch from source
bun test                # all packages
bun run typecheck       # tsc across the workspace
bun run check           # Biome lint + format
bun run build           # compile a binary for the host platform → dist/
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow, and
[SECURITY.md](SECURITY.md) for the security model and how to report vulnerabilities.

## Packages

The repo is a Bun workspace; the published `friday-code` binary bundles all of them.

| Package | Purpose |
|---------|---------|
| `@friday/shared`    | shared types, theme + mode tokens, engine↔UI bus contract |
| `@friday/core`      | engine: runners, agent loop, compaction, hooks, git, sessions, modes, permissions |
| `@friday/providers` | zero-SDK provider wire adapters + model catalog |
| `@friday/tools`     | built-in agent tools |
| `@friday/mcp`       | MCP client (stdio + streamable-http) |
| `@friday/lsp`       | language-server client (diagnostics, hover, definition, symbols) |
| `@friday/tui`       | OpenTUI (Solid) interface + motion layer |
| `@friday/cli`       | binary entry point |

## Roadmap

- Amazon Bedrock (SigV4) provider.
- Split-pane (tmux-style) multiple sessions visible at once.
- Configurable keybindings, theme variants, OS-level bash sandboxing.

## License

[MIT](LICENSE) © Yashwanth Reddy Katipally
