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

On first run, the `/model` connector opens automatically — pick a provider, paste a key, choose a
model. Then just talk to Friday.

Requires [Bun](https://bun.sh) ≥ 1.3.

## Features

- **Agentic loop** — streaming, tool-calling, human-in-the-loop, multi-step until done.
- **Providers (zero-SDK)** — one OpenAI-compatible adapter (OpenAI, OpenRouter, Groq, Kimi/Moonshot,
  MiniMax, DeepSeek, xAI, OpenCode Zen, Together, Ollama, llama.cpp), plus **Anthropic** and
  **Google Gemini**. Model catalog from [models.dev](https://models.dev) with an offline snapshot.
- **Modes** — `plan` / `default` / `accept-edit` / `yolo`, cycled with **Shift+Tab**; the whole frame
  recolors. Permission posture is per-mode.
- **Tools** — read, write, edit, multi-edit, ls, glob, grep, bash, webfetch, websearch, ask_user,
  skill, task (read-only sub-agent).
- **Sessions** — multi-session tabs, `bun:sqlite` persistence, `Ctrl+1-9` to switch, clean-exit
  screen, resume with `friday -s <id>` or `friday -c`.
- **Commands & context** — slash commands + `Ctrl+K` palette, `/`+`@` autocomplete, `@file` mentions,
  FRIDAY.md / AGENTS.md project context, markdown skills (`.friday/skills`).
- **MCP** — connect stdio or streamable-HTTP MCP servers; their tools merge into the registry.
- **Mouse everywhere** — click panels/tabs/cards, drag panel borders to resize, copy-on-select.

## Configuration

Everything lives under `~/.friday/` (override with `FRIDAY_HOME`):

- `auth.json` — provider keys (managed by the `/model` modal).
- `config.json` — selected model/effort/mode, and an optional `mcp` block:
  ```json
  {
    "mcp": {
      "my-server": { "type": "stdio", "command": ["my-mcp-server"] },
      "remote":    { "type": "http",  "url": "https://example.com/mcp" }
    }
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
| `@friday/core`      | engine: agent loop, sessions, modes, permissions, config, context, skills |
| `@friday/providers` | zero-SDK provider wire adapters + model catalog |
| `@friday/tools`     | built-in agent tools |
| `@friday/mcp`       | MCP client (stdio + streamable-http) |
| `@friday/tui`       | OpenTUI (Solid) interface |
| `@friday/cli`       | binary entry point |

## Roadmap

- Amazon Bedrock (SigV4) provider.
- Split-pane (tmux-style) multiple sessions visible at once.
- Configurable keybindings, theme variants.
