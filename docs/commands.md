# Slash commands

Type `/` in the composer to open the command list with autocomplete. Most
commands open a panel or modal in the TUI. A few run as a normal prompt (marked
below), and two run on the engine. Anything that is not a built-in is matched
against your custom commands in `~/.friday/commands/` or `.friday/commands/`
(see [configuration](configuration.md)).

For steering a running agent, see [steer](steer.md).

## Session

| Command | What it does |
|---|---|
| `/new` | Start a new session in this window. |
| `/clear` | Clear the conversation and reset this window. |
| `/resume` | Resume or switch to another session. Aliases: `/sessions`, `/history`. |
| `/fork` | Branch a session from a past turn. |
| `/dir` | Change or add a working directory. |
| `/undo` | Rewind files and chat to an earlier checkpoint. |
| `/compact` | Summarize old context to free space. Runs on the engine. |
| `/exit` | Quit Friday. Alias: `/quit`. |

## Steer

| Command | What it does |
|---|---|
| `/steer` | Steer the agent now: cut the current generation and open a composer to fold in context it missed or redirect it. Also Ctrl+Space. |

`/steer` only works while the agent is busy — if it is idle, you get a "nothing
to steer" toast. Any text typed after the command is ignored; the composer modal
is the single entry point (type a note, `@file` mentions included, then Enter to
fold it in and resume, or Esc to release without adding anything). See
[steer](steer.md) for the full picture.

## Model and reasoning

| Command | What it does |
|---|---|
| `/model` | Connect a provider or pick a model. The picker validates the key before saving. |
| `/effort` | Set reasoning effort with a slider (low to max). Only for models with a reasoning channel. |
| `/budget` | Set a token or dollar usage budget. Examples: `/budget 100000`, `/budget $5`, `/budget off`. |

## Audit and project

| Command | What it does |
|---|---|
| `/init` | Scan the repo and write a `FRIDAY.md` guide. Runs as a prompt. |
| `/review` | Review uncommitted changes and report issues. Runs as a prompt. |
| `/security-review` | Audit uncommitted changes for security issues. Runs as a prompt. |
| `/commit` | Stage everything and commit with a drafted message. Runs on the engine. |

## Tools and integrations

| Command | What it does |
|---|---|
| `/mcp` | View, add, or remove MCP servers. |
| `/skills` | Browse installed skills and run one. |
| `/browser` | Launch the browser and activate the browser tools. `/browser close` stops it. Alias: `/chrome`. |
| `/computer` | Open the desktop-control panel to install, remove, and check device support. |
| `/mic` | Talk to Friday with on-device speech-to-text. Also Ctrl+R. Alias: `/voice`. |

See [integrations](integrations.md) for browser, computer use, and voice.

## Status and environment

| Command | What it does |
|---|---|
| `/context` | Show what is in the context window. Aliases: `/usage`, `/stats`. |
| `/doctor` | Check model, provider, and environment health. |
| `/permissions` | View remembered approvals. `/permissions clear` resets them. |
| `/theme` | Switch the UI theme. Applies on next launch. |
| `/settings` | Open settings — autoupdate, keybindings, editor, theme. Also Ctrl+G. Alias: `/config`. |
| `/update` | Check for a new version and update Friday. |
| `/help` | Show the keymap. Also `?` or `F1`. |
