import { theme } from "@friday/shared"
import { For, Show } from "solid-js"
import { useApp } from "../store.tsx"
import { Pressable } from "./Pressable.tsx"

/**
 * A thin rail of chips ABOVE the status strip showing the agents/teams/swarms spawned from this
 * project — so the user can see them at a glance and jump to any one WITHOUT replacing the chat view.
 * Clicking a chip opens that agent (or the team console) in its OWN terminal window; the main chat
 * stays exactly where it is. No dead-ends: the chat is never navigated away from here.
 */
export function AgentChips() {
  const app = useApp()
  // Background agents from this terminal + agents running in other terminals of the project.
  const agents = () => {
    const local = app.tasks().map((t) => ({ id: t.id, label: t.title || t.description, busy: t.status === "running", remote: false }))
    const remote = app
      .remoteAgents()
      .filter((p) => p.kind === "task")
      .map((p) => ({ id: p.sessionId, label: p.title || p.description, busy: p.busy, remote: true }))
    return [...local, ...remote]
  }
  const team = () => app.team()
  const has = () => !!team() || agents().length > 0

  return (
    <Show when={has()}>
      <box flexDirection="row" height={1} paddingLeft={1} paddingRight={1} gap={1} alignItems="center">
        <text fg={theme.textFaint}>agents</text>
        {/* team → opens the live console in its own window */}
        <Show when={team()}>
          <Pressable
            label={`▦ ${team()!.goal.slice(0, 18)} · ${team()!.members.length}`}
            fg={theme.brand}
            onClick={() => app.openConsoleWindow()}
          />
        </Show>
        {/* one chip per background/swarm agent → opens a watch window */}
        <For each={agents()}>
          {(a) => (
            <Pressable
              label={`${a.busy ? "●" : "○"} ${a.label.slice(0, 16)}${a.remote ? " ⟂" : ""}`}
              fg={a.busy ? theme.success : theme.textMuted}
              onClick={() => app.openAgentWindow(a.id)}
            />
          )}
        </For>
        <box flexGrow={1} />
        <Pressable label="▦ dashboard" fg={theme.textFaint} onClick={() => app.toggleDashboard()} />
      </box>
    </Show>
  )
}
