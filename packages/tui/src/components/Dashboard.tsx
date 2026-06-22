import { theme } from "@friday/shared"
import { useKeyboard } from "@opentui/solid"
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { useApp, type ViewItem } from "../store.tsx"
import { dot, line } from "./ConsoleView.tsx"

/**
 * Mission Control — one umbrella over the three multi-agent surfaces, so the user has a single
 * mental model and a single key (Ctrl+O) to jump into any agent and reliably come back:
 *
 *   SESSIONS — your parallel projects/conversations (you drive each).      ⏎ jump in (Ctrl+1..9 = fast-path)
 *   TEAMS    — Friday orchestrates workers toward ONE goal (shared board). ⏎ open the team console
 *   SWARM    — independent agents on different tasks (you collect later).  v watch · ⏎ adopt · s stop
 *   HISTORY  — every past session across directories (resume any).        ⏎ resume
 *
 * Jump into anything → esc / Ctrl+O always returns here. Tab / ←→ switch surface; j/k move.
 */
const TABS = ["Sessions", "Teams", "Swarm", "History"] as const

function short(cwd: string): string {
  const parts = cwd.split("/").filter(Boolean)
  return parts.slice(-2).join("/") || cwd
}

/** Compact relative time for the history list. */
function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return "just now"
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export function MissionControl() {
  const app = useApp()
  const [tab, setTab] = createSignal(0)
  const [sel, setSel] = createSignal(0)

  const sessions = () => app.sessions()
  const teams = () => (app.team() ? [app.team()!] : [])
  const swarm = () => app.tasks()
  const history = () => [...app.allSessions()].sort((a, b) => b.updatedAt - a.updatedAt)
  const len = () => [sessions().length, teams().length, swarm().length, history().length][tab()]!
  const clampedSel = () => Math.min(sel(), Math.max(0, len() - 1))

  // Swarm watch tail (selected agent's recent transcript).
  const swarmTail = createMemo<ViewItem[]>(() => {
    const t = swarm()[clampedSel()]
    return t ? (app.sessionItems[t.id] ?? []).slice(-12) : []
  })

  useKeyboard((key) => {
    if (app.view() !== "mission") return
    if (key.name === "escape") return app.setView("shell")
    if (key.name === "tab" || key.name === "right") {
      setTab((t) => (t + 1) % TABS.length)
      return setSel(0)
    }
    if (key.name === "left") {
      setTab((t) => (t + TABS.length - 1) % TABS.length)
      return setSel(0)
    }
    if (key.name === "j" || key.name === "down") return setSel((s) => Math.min(len() - 1, s + 1))
    if (key.name === "k" || key.name === "up") return setSel((s) => Math.max(0, s - 1))
    const enter = key.name === "return" || key.name === "enter" || key.name === "v"
    if (tab() === 0) {
      const s = sessions()[clampedSel()]
      if (s && enter) return app.visitAgent(s.id)
    } else if (tab() === 1) {
      if (teams()[clampedSel()] && enter) return app.setView("console")
    } else if (tab() === 2) {
      const t = swarm()[clampedSel()]
      if (!t) return
      if (key.name === "return" || key.name === "enter") return app.visitAgent(t.id)
      if (key.name === "s") return app.stopAgent(t.id)
    } else {
      const h = history()[clampedSel()]
      if (h && enter) return app.visitAgent(h.id)
    }
  })

  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={theme.bgPanel} paddingLeft={1} paddingRight={1}>
      {/* header + tabs */}
      <box flexDirection="row" gap={2} paddingTop={1} paddingBottom={1}>
        <text fg={theme.info}>▣ mission control</text>
        <For each={TABS}>
          {(name, i) => (
            <text fg={i() === tab() ? theme.text : theme.textFaint}>{i() === tab() ? `[${name}]` : ` ${name} `}</text>
          )}
        </For>
        <box flexGrow={1} />
        <text fg={theme.textFaint}>tab/←→ surface · j/k move · esc back</text>
      </box>

      <Switch>
        {/* SESSIONS — your parallel projects */}
        <Match when={tab() === 0}>
          <box
            flexDirection="column"
            flexGrow={1}
            borderStyle="single"
            border
            borderColor={theme.border}
            paddingLeft={1}
            paddingRight={1}
          >
            <text fg={theme.textFaint}>your parallel projects — you drive each ({sessions().length})</text>
            <Show when={sessions().length} fallback={<text fg={theme.textFaint}>(no sessions)</text>}>
              <For each={sessions()}>
                {(s, i) => {
                  const on = () => i() === clampedSel()
                  const d = () =>
                    app.sessionRunning(s.id)
                      ? dot("running")
                      : app.sessionNeedsInput(s.id)
                        ? { g: "◆", c: theme.warning }
                        : { g: "○", c: theme.textMuted }
                  return (
                    <box
                      flexDirection="row"
                      gap={1}
                      backgroundColor={on() ? theme.bgHover : "transparent"}
                      onMouseDown={() => setSel(i())}
                    >
                      <text fg={d().c}>{d().g}</text>
                      <text fg={on() ? theme.text : theme.textMuted}>{s.title}</text>
                      <text fg={theme.textFaint}>{short(s.cwd)}</text>
                      <box flexGrow={1} />
                      <Show when={s.id === app.activeSession()}>
                        <text fg={theme.success}>» current</text>
                      </Show>
                    </box>
                  )
                }}
              </For>
            </Show>
            <box flexGrow={1} />
            <text fg={theme.textFaint}>⏎ jump in · Ctrl+1..9 fast-path · Ctrl+Y history</text>
          </box>
        </Match>

        {/* TEAMS — Friday orchestrates one goal */}
        <Match when={tab() === 1}>
          <box
            flexDirection="column"
            flexGrow={1}
            borderStyle="single"
            border
            borderColor={theme.border}
            paddingLeft={1}
            paddingRight={1}
          >
            <text fg={theme.textFaint}>Friday-orchestrated workers on one goal (shared board)</text>
            <Show
              when={teams().length}
              fallback={
                <box flexGrow={1} alignItems="center" justifyContent="center">
                  <text fg={theme.textFaint}>No team running. Ask Friday to spawn_team a goal with roles.</text>
                </box>
              }
            >
              <For each={teams()}>
                {(t, i) => {
                  const on = () => i() === clampedSel()
                  return (
                    <box
                      flexDirection="row"
                      gap={1}
                      backgroundColor={on() ? theme.bgHover : "transparent"}
                      onMouseDown={() => setSel(i())}
                    >
                      <text fg={dot(t.status).c}>{dot(t.status).g}</text>
                      <text fg={on() ? theme.text : theme.textMuted}>{t.goal}</text>
                      <box flexGrow={1} />
                      <text fg={theme.textFaint}>
                        {t.members.length} agents · {t.status}
                      </text>
                    </box>
                  )
                }}
              </For>
            </Show>
            <box flexGrow={1} />
            <text fg={theme.textFaint}>⏎ open team console (Ctrl+T)</text>
          </box>
        </Match>

        {/* SWARM — independent agents, inline panes */}
        <Match when={tab() === 2}>
          <box flexDirection="row" flexGrow={1} gap={1}>
            <box
              flexDirection="column"
              width={36}
              borderStyle="single"
              border
              borderColor={theme.border}
              paddingLeft={1}
              paddingRight={1}
            >
              <text fg={theme.textFaint}>independent agents ({swarm().length})</text>
              <Show when={swarm().length} fallback={<text fg={theme.textFaint}>(none — spawn_agents to fan out)</text>}>
                <For each={swarm()}>
                  {(t, i) => {
                    const on = () => i() === clampedSel()
                    return (
                      <box
                        flexDirection="row"
                        gap={1}
                        backgroundColor={on() ? theme.bgHover : "transparent"}
                        onMouseDown={() => setSel(i())}
                      >
                        <text fg={dot(t.status).c}>{dot(t.status).g}</text>
                        <text fg={on() ? theme.text : theme.textMuted}>{(t.title || t.description).slice(0, 24)}</text>
                      </box>
                    )
                  }}
                </For>
              </Show>
              <box flexGrow={1} />
              <text fg={theme.textFaint}>j/k move · v watch</text>
              <text fg={theme.textFaint}>⏎ adopt · s stop · esc</text>
            </box>
            <box
              flexDirection="column"
              flexGrow={1}
              borderStyle="single"
              border
              borderColor={theme.borderActive}
              paddingLeft={1}
              paddingRight={1}
            >
              <text fg={theme.textFaint}>watching: {swarm()[clampedSel()]?.title ?? "—"} (⏎ adopt full session)</text>
              <Show when={swarmTail().length} fallback={<text fg={theme.textFaint}>(no output yet)</text>}>
                <For each={swarmTail()}>
                  {(it) => {
                    const l = line(it)
                    return <text fg={l.c}>{l.text.replace(/\n/g, " ").slice(0, 200)}</text>
                  }}
                </For>
              </Show>
            </box>
          </box>
        </Match>

        {/* HISTORY — every past session across directories, resume any */}
        <Match when={tab() === 3}>
          <box
            flexDirection="column"
            flexGrow={1}
            borderStyle="single"
            border
            borderColor={theme.border}
            paddingLeft={1}
            paddingRight={1}
          >
            <text fg={theme.textFaint}>past sessions — newest first ({history().length})</text>
            <Show when={history().length} fallback={<text fg={theme.textFaint}>(no history yet)</text>}>
              <For each={history()}>
                {(s, i) => {
                  const on = () => i() === clampedSel()
                  return (
                    <box
                      flexDirection="row"
                      gap={1}
                      backgroundColor={on() ? theme.bgHover : "transparent"}
                      onMouseDown={() => setSel(i())}
                    >
                      <text fg={s.id === app.activeSession() ? theme.success : theme.textMuted}>
                        {s.id === app.activeSession() ? "●" : "○"}
                      </text>
                      <text fg={on() ? theme.text : theme.textMuted}>{s.title}</text>
                      <text fg={theme.textFaint}>{short(s.cwd)}</text>
                      <box flexGrow={1} />
                      <text fg={theme.textFaint}>{ago(s.updatedAt)}</text>
                    </box>
                  )
                }}
              </For>
            </Show>
            <box flexGrow={1} />
            <text fg={theme.textFaint}>⏎ resume · esc back</text>
          </box>
        </Match>
      </Switch>
    </box>
  )
}
