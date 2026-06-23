# Agents, teams, and swarms

Friday can do more than run one loop. It can spawn read-only helpers, fan out a
swarm of independent workers, or stand up a coordinated team that shares a board.
These are agent capabilities (tools the model calls), surfaced in the TUI through
the dashboard, console, and fleet.

## Sub-agents

The `task` tool spawns a read-only sub-agent for a scoped piece of work, usually
search or analysis across many files, and returns a summary instead of dumping
everything into the main conversation. Sub-agents cannot edit or run shell, so
they are safe to fan out.

Custom sub-agents live in `~/.friday/agents/` or `.friday/agents/` as Markdown
with frontmatter (`name`, `description`, a read-only `tools` allowlist, and an
optional `model`). See [configuration](configuration.md).

## Swarms

`spawn_agents` launches several independent agents at once, each working its own
copy of the task. Use it when the work splits cleanly and you want breadth.
Background task tools (`task_create`, `task_list`, `task_status`, `task_stop`,
and `send_to_task`) manage longer-running work that outlives a single turn.

## Teams

`spawn_team` creates a coordinated team with roles and a shared board. Members
post updates, claim files so two agents do not edit the same thing, and release
them when done. The board tools are `board_post`, `board_read`,
`board_claim_file`, and `board_release_file`.

## Watching them run

| Surface | How to open | What it shows |
|---|---|---|
| Dashboard | `/dashboard` or Ctrl+O | Sessions, Teams, and Swarm in one view. |
| Console | `/console` or Ctrl+T | The live team cockpit: the shared board plus the roster. |
| Fleet | `/fleet` | One real terminal per running agent — a tiled tmux wall when tmux is present, otherwise separate OS windows. |

`/fleet` needs a terminal backend. When **tmux** is available it launches every
session/team/swarm into a tiled "wall" of real terminals you control from the
dashboard: re-arrange the panes (tiled, columns, rows, or main), close one pane
or all of them, and "open the wall" to attach a terminal and watch every pane in
one view. Without tmux it falls back to separate OS windows — Terminal.app/iTerm
on macOS or a detected emulator on Linux (wezterm, gnome-terminal, konsole,
x-terminal-emulator); Windows is not supported. If no backend is found, watch the
agents in the dashboard's Swarm tab instead.

When a delegated agent (sub-agent, team member, or swarm worker) needs to ask a
question or request a permission, the prompt surfaces in your current view —
labeled with the agent that's asking — so you answer in place and the answer
bridges back to that agent without switching windows.

## Scheduling and isolation

- Cron: `cron_create`, `cron_list`, and `cron_delete` schedule recurring runs.
- Worktrees: `enter_worktree`, `exit_worktree`, and `worktree_list` give an agent
  its own git worktree so parallel edits do not collide.
