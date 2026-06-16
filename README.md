# Friday Code

A new kind of terminal AI coding agent — built on [OpenTUI](https://opentui.com) (Solid),
with a hand-rolled, dependency-light multi-provider engine.

> Rounded, animated, mouse-first. Dark-grey theme with mode-colored accents. A cute hyperactive
> mascot named **Friday** lives above your composer and reacts to what the agent is doing.

## Quick start

```bash
bun install
bun run friday          # launch the TUI
```

On first run, a short **onboarding** appears, then the `/model` connector — pick a provider, paste a
key, choose a model. Then just talk to Friday.

Requires [Bun](https://bun.sh) ≥ 1.3.

## Features

- **Agentic loop** — streaming, tool-calling, human-in-the-loop, multi-step until done, with
  **context auto-compaction** (~80% of the window, or `/compact`) so long sessions never wall out.
- **Live todos** — the agent maintains a task list (`todo_write`) shown in the right panel.
- **Parallel background sessions** — each session runs its own loop concurrently; switch freely while
  others keep working and **notify** you when they finish or need input.
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
- **Modes** — `plan` / `default` / `accept-edit` / `yolo`, cycled with **Shift+Tab**. Per-mode
  permission posture, plus bash allow/deny lists and risky-command warnings.
- **Tools** — read, write, edit, multi-edit, ls, glob, grep, bash, webfetch, websearch, ask_user,
  skill, task (read-only sub-agent), todo_write, lsp_*.
- **Sessions** — multi-session tabs, `bun:sqlite` persistence, `Ctrl+1-9` to switch, clean-exit
  screen, resume with `friday -s <id>` or `friday -c`.
- **Commands & context** — slash commands + `Ctrl+K` palette, `/`+`@` autocomplete, `@file` mentions,
  FRIDAY.md / AGENTS.md project context, markdown skills (`.friday/skills`).
- **MCP** — connect stdio or streamable-HTTP MCP servers; their tools merge into the registry.
- **Animated, mouse-first** — a real motion layer (easing, modal pop-ins, accordions, item reveals)
  with a `FRIDAY_REDUCED_MOTION=1` fallback; click panels/tabs/cards, drag borders, copy-on-select.

## Configuration

Everything lives under `~/.friday/` (override with `FRIDAY_HOME`):

- `auth.json` — provider keys (managed by the `/model` modal).
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
- `skills/`, `commands/` — user-level markdown skills and slash commands. Project-level equivalents
  live in `.friday/skills` and `.friday/commands`.

## Develop

```bash
bun test                # all packages
bun run typecheck       # tsc across the workspace
```

## Packages

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
