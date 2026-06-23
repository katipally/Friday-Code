# Slash commands

Type `/` in the composer to open the command list with autocomplete. Most
commands open a panel or modal in the TUI. A few run as a normal prompt (marked
below), and two run on the engine. Anything that is not a built-in is matched
against your custom commands in `~/.friday/commands/` or `.friday/commands/`
(see [configuration](configuration.md)).

For the headline steering commands, see [steering](steering.md).

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

## Steering

| Command | What it does |
|---|---|
| `/add` | Pause the agent now and steer: cut the current generation and fold in your note. |
| `/add!` | Add information at the next step: let the current generation finish first. |

See [steering](steering.md) for the full picture, including the bare-`/add`
composer and the cost model.

## Model and reasoning

| Command | What it does |
|---|---|
| `/model` | Connect a provider or pick a model. The picker validates the key before saving. |
| `/effort` | Set reasoning effort with a slider (low to max). Only for models with a reasoning channel. |
| `/budget` | Set a token or dollar usage budget. Examples: `/budget 100000`, `/budget $5`, `/budget off`. |

## Agents, teams, and swarms

| Command | What it does |
|---|---|
| `/dashboard` | Open the dashboard over Sessions, Teams, Swarm, and History. Also Ctrl+O. |
| `/console` | Open the live agent-team cockpit with the shared board and roster. Also Ctrl+T. |
| `/fleet` | Open an external terminal window per running agent. |

See [agents and teams](agents-and-teams.md) for how sub-agents, swarms, and
coordinated teams work.

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
| `/help` | Show the keymap. Also `?` or `F1`. |
