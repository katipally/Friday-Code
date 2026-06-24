import type { TmuxLayout } from "@friday/core"
import { theme } from "@friday/shared"
import { useKeyboard } from "@opentui/solid"
import { createMemo, createSignal, For, type JSX, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { useHover } from "../motion/index.ts"
import { type TaskRow, useApp, type ViewItem } from "../store.tsx"
import { groupSessionsByDir, homeDir } from "../util/sessions.ts"
import { dot, line } from "./ConsoleView.tsx"
import { Pill, SectionLabel, Tabs } from "./ui.tsx"

/**
 * Dashboard — one console over the three multi-agent surfaces plus history. Single mental model,
 * single key (Ctrl+O). Everything here is clickable (tabs, rows, action chips, "+ new" launchers);
 * keyboard works too (tab/←→ switch · j/k move · ⏎ primary action · esc back).
 *
 *   SESSIONS — live sessions running this run, grouped by folder.  click jump · ↗ window · ✗ remove
 *   TEAMS    — Friday orchestrates one goal (shared board).        click open console · ✗ dismiss
 *   SWARM    — independent agents on different tasks.              click watch · adopt · stop · ✗ remove
 *   AGENTS   — reusable agents + teams to delegate to.            ⏎ delegate · + new (AI wizard)
 *
 * Past sessions live in /resume (Ctrl+Y). Launching opens work in its OWN window (new chat/session
 * interactive; team/swarm watch windows), so this view stays the console and updates live.
 */
const TABS = ["Sessions", "Teams", "Swarm", "Agents"] as const

/** A clickable chip used for per-row actions (adopt/stop/↗). */
function Chip(props: { label: string; onClick: () => void; fg?: string }) {
  const h = useHover({ base: "transparent", hover: theme.bgHover })
  return (
    <box
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={h.bg()}
      onMouseOver={h.onMouseOver}
      onMouseOut={h.onMouseOut}
      onMouseDown={props.onClick}
    >
      <text fg={h.hovered() ? theme.text : (props.fg ?? theme.textFaint)}>{props.label}</text>
    </box>
  )
}

/** A selectable/clickable list row with hover highlight. */
function Row(props: { selected: boolean; onSelect: () => void; onActivate?: () => void; children: JSX.Element }) {
  const h = useHover({ base: "transparent", hover: theme.bgHover })
  return (
    <box
      flexDirection="row"
      gap={1}
      backgroundColor={props.selected ? theme.bgSelected : h.bg()}
      onMouseOver={h.onMouseOver}
      onMouseOut={h.onMouseOut}
      onMouseDown={() => {
        props.onSelect()
        props.onActivate?.()
      }}
    >
      {props.children}
    </box>
  )
}

export function Dashboard() {
  const app = useApp()
  const [tab, setTab] = createSignal(0)
  const [sel, setSel] = createSignal(0)
  // inline launcher input: "" (none) | "team" | "swarm" | "agent" | "teamdef"
  const [compose, setCompose] = createSignal<"" | "team" | "swarm" | "agent" | "teamdef">("")
  const [composeName, setComposeName] = createSignal("")
  const [draft, setDraft] = createSignal("")
  // Chrome surface — brand amber, never the per-mode chat accent.
  const accent = () => theme.brand

  // Live sessions grouped by workspace folder (same grouping as the /resume modal).
  const grouped = createMemo(() => groupSessionsByDir(app.sessions()))
  const sessions = () => grouped().flat
  const teams = () => (app.team() ? [app.team()!] : [])
  // Swarm = this terminal's background agents PLUS agents running in OTHER terminals of this project
  // (cross-process presence), so every dashboard shows the same live set. Remote rows get window/stop.
  type SwarmRow = TaskRow & { remote?: boolean }
  const swarm = (): SwarmRow[] => [
    ...app.tasks(),
    ...app
      .remoteAgents()
      .filter((p) => p.kind === "task")
      .map((p) => ({
        id: p.sessionId,
        title: p.title || p.description,
        description: p.description,
        status: p.busy ? ("running" as const) : ("done" as const),
        remote: true,
      })),
  ]
  // Live sessions running in other terminals of this project (shown read-only under the local list).
  const remoteSessions = () => app.remoteAgents().filter((p) => p.kind === "session")
  // Agents tab: a flat selectable list of agent defs followed by team defs.
  const agentList = () => app.agentDefs().filter((a) => a.name !== "friday")
  const teamList = () => app.teamDefs()
  const agentsTabLen = () => agentList().length + teamList().length
  const len = () => [sessions().length, teams().length, swarm().length, agentsTabLen()][tab()]!
  const clampedSel = () => Math.min(sel(), Math.max(0, len() - 1))

  const swarmTail = createMemo<ViewItem[]>(() => {
    const t = swarm()[clampedSel()]
    return t ? (app.sessionItems[t.id] ?? []).slice(-12) : []
  })

  // Live updates: in-process teams/tasks already stream via the bus; poll for sessions/history so
  // externally-opened windows (separate friday processes) show up promptly.
  onMount(() => {
    app.refreshWall()
    const iv = setInterval(() => {
      app.refreshSessions()
      app.refreshWall()
    }, 1500)
    onCleanup(() => clearInterval(iv))
  })

  const LAYOUTS: { key: TmuxLayout; label: string }[] = [
    { key: "tiled", label: "tiled" },
    { key: "even-horizontal", label: "cols" },
    { key: "even-vertical", label: "rows" },
    { key: "main-vertical", label: "main" },
  ]

  function switchTab(n: number) {
    setTab((n + TABS.length) % TABS.length)
    setSel(0)
    setCompose("")
  }
  function submitCompose() {
    const v = draft().trim()
    if (compose() === "team" && v) app.launchTeam(v)
    if (compose() === "swarm" && v) app.launchSwarm(v.split(";"))
    if (compose() === "agent" && v) app.launchAgent(composeName(), v)
    if (compose() === "teamdef") app.launchTeamDef(composeName(), v)
    setDraft("")
    setCompose("")
    setComposeName("")
  }

  useKeyboard((key) => {
    if (app.view() !== "dashboard") return
    if (compose()) {
      // the <input> owns typing; only esc cancels the launcher here
      if (key.name === "escape") {
        setCompose("")
        setDraft("")
      }
      return
    }
    if (key.name === "escape") return app.setView("shell")
    if (key.name === "tab" || key.name === "right") return switchTab(tab() + 1)
    if (key.name === "left") return switchTab(tab() - 1)
    if (key.name === "j" || key.name === "down") return setSel((s) => Math.min(len() - 1, s + 1))
    if (key.name === "k" || key.name === "up") return setSel((s) => Math.max(0, s - 1))
    const enter = key.name === "return" || key.name === "enter"
    if (tab() === 0) {
      const s = sessions()[clampedSel()]
      if (!s) return
      if (enter) return app.visitAgent(s.id)
      if (key.name === "d") return app.deleteSession(s.id)
    } else if (tab() === 1) {
      if (!teams()[clampedSel()]) return
      if (enter) return app.setView("console")
      if (key.name === "d") return app.dismissTeam()
    } else if (tab() === 2) {
      const t = swarm()[clampedSel()]
      if (!t) return
      if (enter) return t.remote ? app.resumeInWindow(t.id) : app.visitAgent(t.id)
      if (key.name === "s") return app.stopAgent(t.id)
      if (key.name === "d" && !t.remote) return app.removeAgent(t.id)
    } else if (tab() === 3) {
      if (!enter) return
      const i = clampedSel()
      const agents = agentList()
      if (i < agents.length) {
        setComposeName(agents[i]!.name)
        setCompose("agent")
      } else {
        const t = teamList()[i - agents.length]
        if (!t) return
        setComposeName(t.name)
        setCompose("teamdef")
      }
    }
  })

  const tabCount = (i: number) =>
    [sessions().length, teams().length, swarm().length, agentsTabLen()][i]!

  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={theme.bgPanel} paddingLeft={2} paddingRight={2}>
      {/* header + clickable tabs */}
      <box flexDirection="row" gap={1} paddingTop={1} paddingBottom={1} alignItems="center">
        <text fg={accent()}>
          <strong>▦ DASHBOARD</strong>
        </text>
        <box flexGrow={0} paddingLeft={1} />
        <Tabs
          items={TABS.map((name, i) => ({ label: `${name} ${tabCount(i)}`, key: String(i) }))}
          active={String(tab())}
          onSelect={(k) => switchTab(Number(k))}
        />
        <box flexGrow={1} />
        <text fg={theme.textFaint}>
          {(() => {
            const w = app.engine.windowBackend()
            return w.osWindows ? `↗ ${w.backend}` : "↗ in-TUI only"
          })()}
          {"  ·  esc back"}
        </text>
      </box>

      {/* tmux WALL control center — real, tile-able terminals. Launching anything from the tabs below
          adds a pane here; arrange / open / close the whole wall from this bar. Hidden without tmux. */}
      <Show when={app.tmuxOn()}>
        <box
          flexDirection="column"
          backgroundColor={theme.bgElevated}
          paddingLeft={1}
          paddingRight={1}
          marginBottom={1}
        >
          <box flexDirection="row" gap={1} alignItems="center">
            <text fg={accent()}>
              <strong>▦ wall</strong>
            </text>
            <text fg={theme.textFaint}>{app.wallPanes().length} pane(s)</text>
            <box flexGrow={1} />
            <For each={LAYOUTS}>{(l) => <Pill label={l.label} onClick={() => app.arrangeWall(l.key)} />}</For>
            <Pill label="⊞ open" accent={theme.success} onClick={() => app.viewWall()} />
            <Show when={app.wallPanes().length}>
              <Pill label="✕ close all" accent={theme.error} onClick={() => app.closeWall()} />
            </Show>
          </box>
          {/* Per-pane list with individual close. */}
          <Show when={app.wallPanes().length}>
            <box flexDirection="row" gap={2} paddingTop={0}>
              <For each={app.wallPanes()}>
                {(p) => (
                  <box flexDirection="row" gap={1} onMouseDown={() => app.removeWallPane(p.id)}>
                    <text fg={p.active ? theme.brand : theme.textMuted}>{p.title}</text>
                    <text fg={theme.error}>✕</text>
                  </box>
                )}
              </For>
            </box>
          </Show>
        </box>
      </Show>

      <Switch>
        {/* SESSIONS */}
        <Match when={tab() === 0}>
          <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1}>
            <box flexDirection="row" alignItems="center" paddingBottom={1}>
              <text fg={theme.textFaint}>live sessions this run — grouped by folder</text>
              <box flexGrow={1} />
              <Pill label="＋ new chat" onClick={() => app.newChatWindow()} />
            </box>
            <Show when={sessions().length} fallback={<text fg={theme.textFaint}>(no sessions — + new chat)</text>}>
              <For each={grouped().rows}>
                {(row) => {
                  if ("dir" in row) {
                    return (
                      <box marginTop={1}>
                        <text fg={theme.textMuted}>{homeDir(row.dir)}</text>
                      </box>
                    )
                  }
                  const s = row.session
                  const d = () =>
                    app.sessionRunning(s.id)
                      ? dot("running")
                      : app.sessionNeedsInput(s.id)
                        ? { g: "◆", c: theme.warning }
                        : { g: "○", c: theme.textMuted }
                  return (
                    <Row
                      selected={row.index === clampedSel()}
                      onSelect={() => setSel(row.index)}
                      onActivate={() => app.visitAgent(s.id)}
                    >
                      <text fg={d().c}>{d().g}</text>
                      <text fg={row.index === clampedSel() ? theme.text : theme.textMuted}>{s.title}</text>
                      <box flexGrow={1} />
                      <Show when={s.id === app.activeSession()}>
                        <text fg={theme.success}>» current</text>
                      </Show>
                      <Chip label="↗ window" onClick={() => app.resumeInWindow(s.id)} />
                      <Chip label="✗" fg={theme.error} onClick={() => app.deleteSession(s.id)} />
                    </Row>
                  )
                }}
              </For>
            </Show>
            <Show when={remoteSessions().length}>
              <box marginTop={1}>
                <text fg={theme.textMuted}>other terminals (this project)</text>
              </box>
              <For each={remoteSessions()}>
                {(p) => (
                  <Row selected={false} onSelect={() => {}} onActivate={() => app.resumeInWindow(p.sessionId)}>
                    <text fg={p.busy ? theme.success : theme.textMuted}>{p.busy ? "●" : "○"}</text>
                    <text fg={theme.textMuted}>{p.title}</text>
                    <text fg={theme.textFaint}>⟂</text>
                    <box flexGrow={1} />
                    <Chip label="↗ window" onClick={() => app.resumeInWindow(p.sessionId)} />
                    <Show when={p.busy}>
                      <Chip label="stop" fg={theme.warning} onClick={() => app.stopAgent(p.sessionId)} />
                    </Show>
                  </Row>
                )}
              </For>
            </Show>
            <box flexGrow={1} />
            <text fg={theme.textFaint}>⏎ jump · ↗ window · d/✗ remove · ⟂ = another terminal · Ctrl+1..9</text>
          </box>
        </Match>

        {/* TEAMS */}
        <Match when={tab() === 1}>
          <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1}>
            <box flexDirection="row" alignItems="center" paddingBottom={1}>
              <text fg={theme.textFaint}>Friday orchestrates workers on one goal (shared board)</text>
              <box flexGrow={1} />
              <Pill
                label="＋ new team"
                onClick={() => setCompose(compose() === "team" ? "" : "team")}
                selected={compose() === "team"}
              />
            </box>
            <Show when={compose() === "team"}>
              <box flexDirection="column" paddingBottom={1}>
                <text fg={theme.textFaint}>goal — Friday picks the roles (⏎ launch · esc cancel)</text>
                <box backgroundColor={theme.bgComposer} paddingLeft={1} paddingRight={1}>
                  <input
                    value={draft()}
                    onInput={setDraft}
                    onSubmit={submitCompose}
                    focused
                    placeholder="e.g. refactor auth and add tests"
                    placeholderColor={theme.textFaint}
                  />
                </box>
              </box>
            </Show>
            <Show when={teams().length} fallback={<text fg={theme.textFaint}>(no team running — + new team)</text>}>
              <For each={teams()}>
                {(t, i) => (
                  <Row
                    selected={i() === clampedSel()}
                    onSelect={() => setSel(i())}
                    onActivate={() => app.setView("console")}
                  >
                    <text fg={dot(t.status).c}>{dot(t.status).g}</text>
                    <text fg={i() === clampedSel() ? theme.text : theme.textMuted}>{t.goal}</text>
                    <box flexGrow={1} />
                    <text fg={theme.textFaint}>
                      {t.members.length} agents · {t.status}
                    </text>
                    <Chip label="open ›" onClick={() => app.setView("console")} />
                    <Chip label="✗" fg={theme.error} onClick={() => app.dismissTeam()} />
                  </Row>
                )}
              </For>
            </Show>
            <box flexGrow={1} />
            <text fg={theme.textFaint}>⏎ / click open console · d / ✗ dismiss team · + new team to start one</text>
          </box>
        </Match>

        {/* SWARM */}
        <Match when={tab() === 2}>
          <box flexDirection="column" flexGrow={1} gap={1}>
            <box flexDirection="row" alignItems="center">
              <text fg={theme.textFaint}>independent agents — different tasks, you collect</text>
              <box flexGrow={1} />
              <Pill
                label="＋ new swarm"
                onClick={() => setCompose(compose() === "swarm" ? "" : "swarm")}
                selected={compose() === "swarm"}
              />
            </box>
            <Show when={compose() === "swarm"}>
              <box flexDirection="column">
                <text fg={theme.textFaint}>tasks separated by ; — one agent per task (⏎ launch · esc cancel)</text>
                <box backgroundColor={theme.bgComposer} paddingLeft={1} paddingRight={1}>
                  <input
                    value={draft()}
                    onInput={setDraft}
                    onSubmit={submitCompose}
                    focused
                    placeholder="write tests; update docs; fix lint"
                    placeholderColor={theme.textFaint}
                  />
                </box>
              </box>
            </Show>
            <box flexDirection="row" flexGrow={1} gap={1}>
              <box
                flexDirection="column"
                width={38}
                backgroundColor={theme.bgElevated}
                paddingLeft={1}
                paddingRight={1}
              >
                <SectionLabel text={`AGENTS (${swarm().length})`} />
                <Show when={swarm().length} fallback={<text fg={theme.textFaint}>(none — + new swarm)</text>}>
                  <For each={swarm()}>
                    {(t, i) => (
                      <Row selected={i() === clampedSel()} onSelect={() => setSel(i())}>
                        <text fg={dot(t.status).c}>{dot(t.status).g}</text>
                        <text fg={i() === clampedSel() ? theme.text : theme.textMuted}>
                          {(t.title || t.description).slice(0, 18)}
                        </text>
                        <Show when={t.remote}>
                          <text fg={theme.textFaint}>⟂</text>
                        </Show>
                        <box flexGrow={1} />
                        <Show when={app.sessionCost()[t.id]}>
                          <text fg={theme.textFaint}>${(app.sessionCost()[t.id] ?? 0).toFixed(3)}</text>
                        </Show>
                        <Show when={!t.remote} fallback={<Chip label="↗ window" onClick={() => app.resumeInWindow(t.id)} />}>
                          <Chip label="adopt" onClick={() => app.visitAgent(t.id)} />
                        </Show>
                        <Show when={t.status === "running"}>
                          <Chip label="stop" fg={theme.warning} onClick={() => app.stopAgent(t.id)} />
                        </Show>
                        <Show when={!t.remote}>
                          <Chip label="✗" fg={theme.error} onClick={() => app.removeAgent(t.id)} />
                        </Show>
                      </Row>
                    )}
                  </For>
                </Show>
              </box>
              <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1}>
                <text fg={theme.textFaint}>
                  watching: {swarm()[clampedSel()]?.title ?? "—"} (adopt = drive it here)
                </text>
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
          </box>
        </Match>

        {/* AGENTS — reusable agents + teams you can delegate to */}
        <Match when={tab() === 3}>
          <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1}>
            <box flexDirection="row" alignItems="center" paddingBottom={1}>
              <text fg={theme.textFaint}>reusable agents & teams — ⏎ delegate · + new (AI wizard)</text>
              <box flexGrow={1} />
              <Pill label="＋ new agent" onClick={() => app.runCommand("agent")} />
              <Pill label="＋ new team" onClick={() => app.runCommand("team")} />
            </box>
            <Show when={compose() === "agent" || compose() === "teamdef"}>
              <box flexDirection="column" paddingBottom={1}>
                <text fg={theme.textFaint}>
                  {compose() === "agent"
                    ? `task for "${composeName()}" (⏎ delegate · esc cancel)`
                    : `goal for "${composeName()}" team — blank uses its default (⏎ launch · esc cancel)`}
                </text>
                <box backgroundColor={theme.bgComposer} paddingLeft={1} paddingRight={1}>
                  <input
                    value={draft()}
                    onInput={setDraft}
                    onSubmit={submitCompose}
                    focused
                    placeholder={compose() === "agent" ? "e.g. review the auth module for bugs" : "e.g. add OAuth login"}
                    placeholderColor={theme.textFaint}
                  />
                </box>
              </box>
            </Show>
            <SectionLabel text={`AGENTS (${agentList().length})`} />
            <For each={agentList()}>
              {(a, i) => (
                <Row
                  selected={i() === clampedSel()}
                  onSelect={() => setSel(i())}
                  onActivate={() => {
                    setComposeName(a.name)
                    setCompose("agent")
                  }}
                >
                  <text fg={a.color ?? theme.textMuted}>{a.glyph ?? "◇"}</text>
                  <text fg={i() === clampedSel() ? theme.text : theme.textMuted}>{a.name}</text>
                  <box flexGrow={1} />
                  <text fg={theme.textFaint}>
                    {[a.model ?? "session model", a.posture ?? "default", a.source].join(" · ")}
                  </text>
                </Row>
              )}
            </For>
            <box marginTop={1} />
            <SectionLabel text={`TEAMS (${teamList().length})`} />
            <For each={teamList()}>
              {(t, i) => {
                const idx = () => agentList().length + i()
                return (
                  <Row
                    selected={idx() === clampedSel()}
                    onSelect={() => setSel(idx())}
                    onActivate={() => {
                      setComposeName(t.name)
                      setCompose("teamdef")
                    }}
                  >
                    <text fg={theme.brand}>▦</text>
                    <text fg={idx() === clampedSel() ? theme.text : theme.textMuted}>{t.name}</text>
                    <box flexGrow={1} />
                    <text fg={theme.textFaint}>
                      {t.members.length} roles · {t.source}
                    </text>
                  </Row>
                )
              }}
            </For>
            <box flexGrow={1} />
            <text fg={theme.textFaint}>⏎ / click delegate · + new agent/team (AI wizard) · esc back</text>
          </box>
        </Match>
      </Switch>
    </box>
  )
}
