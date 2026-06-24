# Built-in tools

These are the capabilities the model calls during a turn. They are gated by the
current mode (see [the modes section in the README](../README.md#modes)): plan is
read-only, default asks before edits and commands, yolo runs everything. Browser
and computer tools are opt-in and stay off until you activate them.

## Files

| Tool | What it does |
|---|---|
| `read` | Read a file. |
| `write` | Create or overwrite a file. |
| `edit` | Make a targeted edit to a file. |
| `multi_edit` | Make several edits to one file in a single call. |
| `apply_patch` | Apply a unified diff. |
| `ls` | List a directory. |
| `glob` | Find files by pattern. |
| `grep` | Search file contents with a regex. |

## Shell and web

| Tool | What it does |
|---|---|
| `bash` | Run a shell command. Snapshots state first so `/undo` can rewind, and gated by the bash allow/deny lists. |
| `webfetch` | Fetch a URL and return it as markdown. |
| `websearch` | Search the web. |

## Control and reasoning

| Tool | What it does |
|---|---|
| `ask_user` | Ask you a question, with inline options when it helps. |
| `todo_write` | Maintain the agent's todo list. |
| `exit_plan` | Finalize a plan in plan mode. |
| `skill` | Load and run a markdown skill. |
| `tool_search` | Discover tools that are not loaded yet. |
| `memory` | Read and write user-level persistent memory. |

## Code intelligence

| Tool | What it does |
|---|---|
| `lsp_hover` | Hover type information. |
| `lsp_definition` | Jump to a definition. |
| `lsp_symbols` | List symbols in a document. |
| `notebook_edit` | Edit Jupyter notebook cells. |

LSP tools work when the matching language server is installed
(typescript-language-server, pyright, gopls, rust-analyzer). They are
auto-detected and skipped if absent.

## Orchestration

| Tool | What it does |
|---|---|
| `delegate` | Run a read-only sub-agent inline (or `background: true` for a detached session). |
| `task` | Spawn a read-only sub-agent. |
| `task_create`, `task_list`, `task_status`, `task_stop`, `send_to_task` | Manage background tasks. |
| `cron_create`, `cron_list`, `cron_delete` | Schedule recurring runs. |
| `enter_worktree`, `exit_worktree`, `worktree_list` | Manage git worktrees. |

## Opt-in

| Tool group | Activate with | What it does |
|---|---|---|
| `browser_*` | `/browser` | Drive a real browser over the Chrome DevTools Protocol. |
| `computer_*` | `/computer` | Control the desktop: mouse, keyboard, screenshots. |

See [integrations](integrations.md).

You can also reach any MCP server's tools once it is connected. See
[configuration](configuration.md) for MCP setup.
