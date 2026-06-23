# Configuration

Everything Friday stores lives under `~/.friday/`. Override the location with the
`FRIDAY_HOME` environment variable.

```
auth.json     provider keys (written 0600 by the /model modal)
config.json   model, effort, mode, mcp, hooks, bash allow/deny, theme, budget
memory/       user-level persistent memory
skills/       user-level markdown skills
agents/       user-level custom agents
commands/     user-level custom commands
sessions/     bun:sqlite session state
logs/         when something goes wrong, look here
```

## API keys

Keys come from two places, with environment variables winning on conflict:

1. Environment variables: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`,
   `GROQ_API_KEY`, and the rest.
2. `auth.json`, written by the `/model` picker after it validates the key against
   the provider. The file is created with `0600` permissions.

Ollama and llama.cpp need no key. See [providers](providers.md) for the full
list.

## config.json

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

Most of these can also be set from inside the TUI: `/model`, `/effort`,
`/theme`, `/budget`, `/mcp`. Changes made there are written back to `config.json`.

## Bash allow and deny

The `bash` block gates shell commands before they run. `deny` blocks a command
outright. `allow` lets a command through without a prompt in default mode. On top
of these lists, Friday detects risky commands (destructive removes, force
pushes, and similar) and asks before running them regardless of mode, except in
yolo. See [SECURITY.md](../SECURITY.md) for the full model.

## Hooks

Hooks shell out to your own scripts at eight points in the loop:

`PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SessionStart`,
`SubagentStop`, `PreCompact`, `Notification`.

Each entry has a `matcher` (a regex against the tool name, where relevant) and a
`command` to run. Use them for formatting after edits, gating commands, or
notifying an external system.

## Project context

Drop a `FRIDAY.md` in the project root to give Friday orientation that travels
with the repo: what the project is, how to build and test it, and any
conventions. If you already keep an `AGENTS.md`, symlink it. Friday reads both at
the start of every session. Run `/init` to have Friday write a `FRIDAY.md` for
you.

## Skills, agents, and commands

These three directories let you extend Friday with plain Markdown. Each exists at
the user level under `~/.friday/` and at the project level under `.friday/`, with
the project copy taking precedence.

- `skills/` holds skills the agent can invoke with the `skill` tool. Each is a
  Markdown file (or a folder with `SKILL.md`) with frontmatter for `name`,
  `description`, and `whenToUse`. Browse and run them with `/skills`.
- `agents/` holds custom sub-agents. Each is a Markdown file (or a folder with
  `AGENT.md`) with frontmatter for `name`, `description`, a read-only `tools`
  allowlist, and an optional `model` override. See
  [agents and teams](agents-and-teams.md).
- `commands/` holds custom slash commands. Each is a Markdown file with a
  `description` in frontmatter and a prompt template in the body. Typing
  `/mycommand some args` sends the template with your args appended.

## Environment variables

| Variable | Effect |
|---|---|
| `FRIDAY_HOME` | Override the `~/.friday/` location. |
| `FRIDAY_REDUCED_MOTION=1` | Disable animations. |
| `COLORTERM=truecolor` | Force truecolor if your terminal supports it but does not advertise it. |
| `ANTHROPIC_API_KEY` and friends | Provider keys. See [providers](providers.md). |
