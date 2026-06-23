import { theme } from "@friday/shared"
import { useKeyboard } from "@opentui/solid"
import { createMemo, createSignal, For, type JSX, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { useHover } from "../motion/index.ts"
import { useApp, type ViewItem } from "../store.tsx"
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
 *
 * Past sessions live in /resume (Ctrl+Y). Launching opens work in its OWN window (new chat/session
 * interactive; team/swarm watch windows), so this view stays the console and updates live.
 */
const TABS = ["Sessions", "Teams", "Swarm"] as const

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
  // inline launcher input: "" (none) | "team" | "swarm"
  const [compose, setCompose] = createSignal<"" | "team" | "swarm">("")
  const [draft, setDraft] = createSignal("")
  // Chrome surface — brand amber, never the per-mode chat accent.
  const accent = () => theme.brand

  // Live sessions grouped by workspace folder (same grouping as the /resume modal).
  const grouped = createMemo(() => groupSessionsByDir(app.sessions()))
  const sessions = () => grouped().flat
  const teams = () => (app.team() ? [app.team()!] : [])
  const swarm = () => app.tasks()
  const len = () => [sessions().length, teams().length, swarm().length][tab()]!
  const clampedSel = () => Math.min(sel(), Math.max(0, len() - 1))

  const swarmTail = createMemo<ViewItem[]>(() => {
    const t = swarm()[clampedSel()]
    return t ? (app.sessionItems[t.id] ?? []).slice(-12) : []
  })

  // Live updates: in-process teams/tasks already stream via the bus; poll for sessions/history so
  // externally-opened windows (separate friday processes) show up promptly.
  onMount(() => {
    const iv = setInterval(() => app.refreshSessions(), 1500)
    onCleanup(() => clearInterval(iv))
  })

  function switchTab(n: number) {
    setTab((n + TABS.length) % TABS.length)
    setSel(0)
    setCompose("")
  }
  function submitCompose() {
    const v = draft().trim()
    if (compose() === "team" && v) app.launchTeam(v)
    if (compose() === "swarm" && v) app.launchSwarm(v.split(";"))
    setDraft("")
    setCompose("")
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
      if (enter) return app.visitAgent(t.id)
      if (key.name === "s") return app.stopAgent(t.id)
      if (key.name === "d") return app.removeAgent(t.id)
    }
  })

  const tabCount = (i: number) => [sessions().length, teams().length, swarm().length][i]!

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
        <text fg={theme.textFaint}>esc back</text>
      </box>

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
            <box flexGrow={1} />
            <text fg={theme.textFaint}>⏎ / click jump in · ↗ new window · d / ✗ remove · Ctrl+1..9 fast-path</text>
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
                        <box flexGrow={1} />
                        <Chip label="adopt" onClick={() => app.visitAgent(t.id)} />
                        <Show when={t.status === "running"}>
                          <Chip label="stop" fg={theme.warning} onClick={() => app.stopAgent(t.id)} />
                        </Show>
                        <Chip label="✗" fg={theme.error} onClick={() => app.removeAgent(t.id)} />
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
      </Switch>
    </box>
  )
}
