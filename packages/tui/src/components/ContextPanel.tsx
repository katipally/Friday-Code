import { getMode, theme } from "@friday/shared"
import { createEffect, createSignal, For, type JSX, Show } from "solid-js"
import { Reveal, shimmerAccent, useHover, useTween } from "../motion/index.ts"
import { useApp } from "../store.tsx"
import { G } from "../util/term.ts"
import { CollapseTab } from "./Divider.tsx"
import { CloseButton } from "./PanelChrome.tsx"
import { Pressable } from "./Pressable.tsx"

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

/** Truncate to fit the panel width, keeping the tail of paths (the filename) visible. */
function truncate(s: string, n: number, fromStart = false): string {
  if (s.length <= n) return s
  return fromStart ? `…${s.slice(s.length - (n - 1))}` : `${s.slice(0, n - 1)}…`
}

/**
 * A prominent quick-action button with a clear hover animation: border lights up to the mode accent
 * and the label brightens on hover; bg tints. Used for the mic + dashboard launchers.
 */
function QuickButton(props: { label: string; hint: string; onClick: () => void; accent: string }) {
  const h = useHover({ base: theme.bgPanel, hover: theme.bgHover })
  return (
    <box
      flexGrow={1}
      flexDirection="row"
      gap={1}
      paddingLeft={1}
      paddingRight={1}
      border
      borderStyle="single"
      borderColor={h.hovered() ? props.accent : theme.border}
      backgroundColor={h.bg()}
      onMouseOver={h.onMouseOver}
      onMouseOut={h.onMouseOut}
      onMouseDown={props.onClick}
    >
      <text fg={h.hovered() ? theme.text : theme.textMuted}>{props.label}</text>
      <box flexGrow={1} />
      <text fg={theme.textFaint}>{props.hint}</text>
    </box>
  )
}

/** A collapsible section that flags `*new` and auto-opens when its content changes. */
function Section(props: {
  label: string
  count?: number
  open: boolean
  fresh?: boolean
  onToggle: () => void
  children: JSX.Element
}) {
  const h = useHover({ base: theme.bgPanel, hover: theme.bgHover })
  return (
    <box flexDirection="column">
      <box
        flexDirection="row"
        gap={1}
        backgroundColor={h.bg()}
        onMouseOver={h.onMouseOver}
        onMouseOut={h.onMouseOut}
        onMouseDown={props.onToggle}
      >
        <text fg={h.hovered() ? theme.text : theme.textMuted}>{props.open ? "▾" : "▸"}</text>
        <text fg={h.hovered() ? theme.text : theme.textMuted}>{props.label}</text>
        <Show when={props.count != null}>
          <text fg={theme.textFaint}>({props.count})</text>
        </Show>
        <Show when={props.fresh}>
          <text fg={theme.warning}>*new</text>
        </Show>
      </box>
      <Reveal when={props.open}>
        <box flexDirection="column" paddingLeft={2}>
          {props.children}
        </box>
      </Reveal>
    </box>
  )
}

/**
 * Right "stats" panel — an always-visible workspace stat block (model, context usage,
 * cost, mcp/skills) plus Todos and Files sections that auto-reveal (with a `*new` flag)
 * the moment the agent updates them.
 */
export function ContextPanel(props: { fullscreen?: boolean; widthOverride?: number } = {}) {
  const app = useApp()
  const accent = () => shimmerAccent(getMode(app.mode()).accent)
  const [todosOpen, setTodosOpen] = createSignal(true)
  const [todosNew, setTodosNew] = createSignal(false)
  const [filesOpen, setFilesOpen] = createSignal(false)
  const [filesNew, setFilesNew] = createSignal(false)
  const [plansOpen, setPlansOpen] = createSignal(false)
  const [plansNew, setPlansNew] = createSignal(false)
  const [tasksOpen, setTasksOpen] = createSignal(false)
  const [tasksNew, setTasksNew] = createSignal(false)
  const [taskHov, setTaskHov] = createSignal(-1)

  // Auto-reveal Todos/Files when their backing data changes (signature compare).
  const todoSig = () =>
    app
      .todos()
      .map((t) => `${t.status}:${t.text}`)
      .join("|")
  const fileSig = () =>
    [
      ...app.changedFiles().map((f) => `${f.status}${f.path}${f.added}${f.removed}`),
      ...app.diagnostics().map((d) => `${d.path}${d.errors}${d.warnings}`),
    ].join("|")
  // Seed each tracker with the CURRENT value (not null) so the effect's first run is a no-op and any
  // later change reliably reveals the section. The previous `!== null` guard suppressed the very
  // first populate (empty → first list), which is exactly when the user wants to see it appear.
  let prevTodo = todoSig()
  let prevFile = fileSig()
  let prevPlan = app.plans().length
  createEffect(() => {
    const sig = todoSig()
    if (sig !== prevTodo && sig) {
      setTodosOpen(true)
      setTodosNew(true)
    }
    prevTodo = sig
  })
  createEffect(() => {
    const sig = fileSig()
    if (sig !== prevFile && sig) {
      setFilesOpen(true)
      setFilesNew(true)
    }
    prevFile = sig
  })
  createEffect(() => {
    const n = app.plans().length
    if (n !== prevPlan && n) {
      setPlansOpen(true)
      setPlansNew(true)
    }
    prevPlan = n
  })
  // Reveal Tasks when the set of background tasks (or their statuses) changes.
  const taskSig = () =>
    app
      .tasks()
      .map((t) => `${t.id}:${t.status}`)
      .join("|")
  let prevTask = taskSig()
  createEffect(() => {
    const sig = taskSig()
    if (sig !== prevTask && sig) {
      setTasksOpen(true)
      setTasksNew(true)
    }
    prevTask = sig
  })

  const toggleTodos = () => {
    setTodosOpen(!todosOpen())
    setTodosNew(false)
  }
  const toggleFiles = () => {
    setFilesOpen(!filesOpen())
    setFilesNew(false)
  }
  const togglePlans = () => {
    setPlansOpen(!plansOpen())
    setPlansNew(false)
  }
  const toggleTasks = () => {
    setTasksOpen(!tasksOpen())
    setTasksNew(false)
  }

  const mcpHover = useHover({ base: theme.bgPanel, hover: theme.bgHover })
  const [planHov, setPlanHov] = createSignal(-1)
  const pct = () =>
    app.contextWindow() > 0 ? Math.min(100, Math.round((app.tokens() / app.contextWindow()) * 100)) : 0
  // The bar tweens toward a target: the live usage normally, the "before" level while compacting,
  // and the freed "after" level the moment a compaction completes (real token count lags a turn).
  const targetPct = () => {
    if (app.compacting()) return app.compactPct().before
    const after = app.compactPct().after
    return after > 0 && after < pct() ? after : pct()
  }
  const shownPct = useTween(targetPct, { duration: 600 })
  const barPct = () => Math.round(shownPct())
  // Usable text width inside the panel (width minus borders/padding) — drives truncation so long
  // model ids and file paths never wrap and deform the layout at the minimum width.
  const innerW = () => Math.max(8, (props.fullscreen ? 60 : (props.widthOverride ?? app.rightWidth())) - 4)
  const budgetOver = () => {
    const b = app.budget()
    if (!b) return false
    return (b.tokens != null && app.tokens() > b.tokens) || (b.usd != null && app.cost() > b.usd)
  }
  const budgetLabel = () => {
    const b = app.budget()
    return b ? (b.usd != null ? `$${b.usd}` : `${fmtTokens(b.tokens ?? 0)} tok`) : ""
  }

  return (
    <Show when={app.rightOpen()} fallback={<CollapseTab side="left" onOpen={() => app.setRightOpen(true)} />}>
      <box
        width={props.fullscreen ? "100%" : (props.widthOverride ?? app.rightWidth())}
        height="100%"
        flexDirection="column"
        backgroundColor={theme.bgPanel}
        paddingTop={1}
      >
        <box flexDirection="row" paddingRight={1} alignItems="center">
          <CloseButton hint="ctrl+b" onClose={() => app.setRightOpen(false)} />
          <box flexGrow={1} />
          <text fg={theme.textMuted}>stats</text>
        </box>

        <scrollbox flexGrow={1} minHeight={0} paddingLeft={1} paddingRight={1} paddingTop={1}>
          <box flexDirection="column" gap={1}>
            {/* Always-on stat block. */}
            <box flexDirection="column">
              <Pressable
                label={truncate(app.model(), innerW() - 2)}
                fg={theme.text}
                onClick={() => app.setModelModalOpen(true)}
              />
              <Show when={app.reasoningModel()}>
                <Pressable label={`◇ ${app.effort()} · tap to change`} onClick={() => app.setEffortOpen(true)} />
              </Show>
            </box>

            <box flexDirection="column">
              <Show
                when={app.contextWindow() > 0}
                fallback={
                  <text fg={theme.textFaint}>
                    {fmtTokens(app.tokens())} tokens · ${app.cost().toFixed(3)}
                  </text>
                }
              >
                <text fg={app.compacting() ? accent() : barPct() > 80 ? theme.warning : accent()}>
                  {"█".repeat(Math.round((barPct() / 100) * 12))}
                  {"░".repeat(12 - Math.round((barPct() / 100) * 12))} {barPct()}%{app.compacting() ? " ↻" : ""}
                </text>
                <text fg={theme.textFaint}>
                  {fmtTokens(app.tokens())}/{fmtTokens(app.contextWindow())} · ${app.cost().toFixed(3)}
                </text>
              </Show>
              {/* Optional usage budget (/budget): warn when tokens or $ exceed it. */}
              <Show when={app.budget()}>
                <text fg={budgetOver() ? theme.error : theme.textFaint}>
                  {budgetOver() ? `${G.warn} ` : ""}budget {budgetLabel()}
                  {budgetOver() ? " exceeded" : ""}
                </text>
              </Show>
            </box>

            {/* Compaction controls: trigger, stop (while running), undo (after a compaction). */}
            <box flexDirection="row" gap={2}>
              <Show
                when={!app.compacting()}
                fallback={<Pressable label="■ stop" fg={theme.error} onClick={() => app.stopCompact()} />}
              >
                <Pressable label="↻ compact chat" onClick={() => app.compactNow()} />
              </Show>
              <Show when={app.canUndoCompact() && !app.compacting()}>
                <Pressable label="↶ undo" onClick={() => app.undoCompact()} />
              </Show>
            </box>

            <box
              flexDirection="row"
              gap={1}
              backgroundColor={mcpHover.bg()}
              onMouseOver={mcpHover.onMouseOver}
              onMouseOut={mcpHover.onMouseOut}
              onMouseDown={() => app.setMcpModalOpen(true)}
            >
              <text fg={app.mcpServers().length ? theme.success : theme.textFaint}>
                ⚡ {app.mcpServers().length} mcp
              </text>
              <text fg={mcpHover.hovered() ? theme.text : theme.textFaint}>· {app.skills().length} skills</text>
            </box>
            <Show when={app.contextFiles().length}>
              <text fg={theme.textFaint}>✓ {app.contextFiles().length} context files</text>
            </Show>

            <text fg={theme.borderMuted}>{"─".repeat(innerW())}</text>

            {/* Quick actions — same as the Ctrl+R / Ctrl+O shortcuts, clickable for mouse users.
                Stacked (mic above dashboard) so each is a full-width target. */}
            <box flexDirection="column" gap={0}>
              <QuickButton label="🎙 mic" hint="Ctrl+R" onClick={() => app.toggleMic()} accent={accent()} />
              <QuickButton label="▦ dashboard" hint="Ctrl+O" onClick={() => app.toggleDashboard()} accent={accent()} />
            </box>

            {/* Plans proposed this session — click one to re-open the full plan + execute gate. */}
            <Section
              label="plans"
              count={app.plans().length}
              open={plansOpen()}
              fresh={plansNew()}
              onToggle={togglePlans}
            >
              <Show when={app.plans().length} fallback={<text fg={theme.textFaint}>none yet</text>}>
                <For each={app.plans()}>
                  {(p, i) => (
                    <box
                      flexDirection="row"
                      gap={1}
                      backgroundColor={planHov() === i() ? theme.bgHover : "transparent"}
                      onMouseOver={() => setPlanHov(i())}
                      onMouseOut={() => setPlanHov(-1)}
                      onMouseDown={() => app.viewPlan(p)}
                    >
                      <text fg={getMode("plan").accent}>{G.modePlan}</text>
                      <text fg={planHov() === i() ? theme.text : theme.textMuted}>
                        {truncate(p.title, innerW() - 9)}
                      </text>
                      <box flexGrow={1} />
                      <Show when={planHov() === i()}>
                        <text fg={theme.textFaint}>view</text>
                      </Show>
                    </box>
                  )}
                </For>
              </Show>
            </Section>

            {/* Background tasks (agent-spawned async sessions) — click to open one's transcript. */}
            <Show when={app.tasks().length}>
              <Section
                label="tasks"
                count={app.tasks().length}
                open={tasksOpen()}
                fresh={tasksNew()}
                onToggle={toggleTasks}
              >
                <For each={app.tasks()}>
                  {(t, i) => (
                    <box
                      flexDirection="row"
                      gap={1}
                      backgroundColor={taskHov() === i() ? theme.bgHover : "transparent"}
                      onMouseOver={() => setTaskHov(i())}
                      onMouseOut={() => setTaskHov(-1)}
                      onMouseDown={() => app.switchSession(t.id)}
                    >
                      <text fg={t.status === "running" ? accent() : theme.success}>
                        {t.status === "running" ? G.caret : G.todoDone}
                      </text>
                      <text fg={taskHov() === i() ? theme.text : theme.textMuted}>
                        {truncate(t.title, innerW() - 6)}
                      </text>
                      <box flexGrow={1} />
                      <Show when={taskHov() === i()}>
                        <text fg={theme.textFaint}>open</text>
                      </Show>
                    </box>
                  )}
                </For>
              </Section>
            </Show>

            {/* Todos — auto-reveals when the agent rewrites the task list. */}
            <Section
              label="todos"
              count={app.todos().length}
              open={todosOpen()}
              fresh={todosNew()}
              onToggle={toggleTodos}
            >
              <Show when={app.todos().length} fallback={<text fg={theme.textFaint}>none yet</text>}>
                <For each={app.todos()}>
                  {(t) => (
                    <box flexDirection="row" gap={1}>
                      <text
                        fg={t.status === "done" ? theme.success : t.status === "active" ? accent() : theme.textFaint}
                      >
                        {t.status === "done" ? G.todoDone : t.status === "active" ? G.caret : G.todoOpen}
                      </text>
                      <text fg={t.status === "active" ? theme.text : theme.textMuted}>{t.text}</text>
                    </box>
                  )}
                </For>
              </Show>
            </Section>

            {/* Everything this session changed — added/modified/removed files AND folders, from its
                own checkpoint snapshots, plus LSP diagnostics. */}
            <Section
              label="changes"
              count={app.changedFiles().length + app.diagnostics().length}
              open={filesOpen()}
              fresh={filesNew()}
              onToggle={toggleFiles}
            >
              <Show
                when={app.changedFiles().length || app.diagnostics().length}
                fallback={<text fg={theme.textFaint}>no changes yet</text>}
              >
                <For each={app.changedFiles()}>
                  {(f) => (
                    <box flexDirection="row" gap={1}>
                      <text fg={f.status === "D" ? theme.error : f.status === "A" ? theme.success : theme.warning}>
                        {f.status}
                      </text>
                      <text fg={theme.textMuted}>{truncate(f.path, innerW() - 6, true)}</text>
                      <Show when={f.kind === "dir"}>
                        <text fg={theme.textFaint}>(dir)</text>
                      </Show>
                      <Show when={f.added || f.removed}>
                        <text fg={theme.success}>+{f.added}</text>
                        <text fg={theme.error}>−{f.removed}</text>
                      </Show>
                    </box>
                  )}
                </For>
                <For each={app.diagnostics()}>
                  {(d) => (
                    <box flexDirection="row" gap={1}>
                      <text fg={d.errors ? theme.error : theme.warning}>{d.errors ? "✗" : "⚠"}</text>
                      <text fg={theme.textMuted}>{truncate(d.path, innerW() - 8, true)}</text>
                      <Show when={d.errors}>
                        <text fg={theme.error}>{d.errors}e</text>
                      </Show>
                      <Show when={d.warnings}>
                        <text fg={theme.warning}>{d.warnings}w</text>
                      </Show>
                    </box>
                  )}
                </For>
              </Show>
            </Section>
          </box>
        </scrollbox>
      </box>
    </Show>
  )
}
