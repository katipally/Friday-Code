import { theme } from "@friday/shared"
import { createEffect, createSignal, For, type JSX, Show } from "solid-js"
import { Reveal, shimmerAccent, useHover, useTween } from "../motion/index.ts"
import { useApp } from "../store.tsx"
import { G } from "../util/term.ts"
import { CollapseTab } from "./Divider.tsx"
import { CloseButton } from "./PanelChrome.tsx"
import { SectionLabel } from "./ui.tsx"

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

/** Truncate to fit the panel width, keeping the tail of paths (the filename) visible. */
function truncate(s: string, n: number, fromStart = false): string {
  if (s.length <= n) return s
  return fromStart ? `…${s.slice(s.length - (n - 1))}` : `${s.slice(0, n - 1)}…`
}

/**
 * A borderless quick-action button that rests on the elevated surface (so it reads as a tappable
 * block against the panel) and brightens to bgHover with a brand-tinted label on hover.
 * Used for the mic + settings launchers.
 */
function QuickButton(props: { label: string; hint: string; onClick: () => void; accent: string }) {
  const h = useHover({ base: theme.bgElevated, hover: theme.bgHover })
  return (
    <box
      flexGrow={1}
      flexDirection="row"
      gap={1}
      marginBottom={1}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={h.bg()}
      onMouseOver={h.onMouseOver}
      onMouseOut={h.onMouseOut}
      onMouseDown={props.onClick}
    >
      <text fg={h.hovered() ? props.accent : theme.textMuted}>{props.label}</text>
      <box flexGrow={1} />
      <text fg={theme.textFaint}>{props.hint}</text>
    </box>
  )
}

/** A thin full-width section divider — the opencode-style rule between sidebar groups. */
function Rule(props: { width: number }) {
  return <text fg={theme.borderMuted}>{"─".repeat(props.width)}</text>
}

/**
 * A raised control chip — an elevated cell that brightens on hover, so the actionable controls (model,
 * effort, compact/undo) read as tappable buttons lifted above the flat panel. The section LABELS stay
 * flat dim text on the panel; only the controls are raised, so the elevation reads as "this is a button"
 * rather than boxing the whole section.
 */
function Chip(props: { label: string; onClick?: () => void; fg?: string; right?: string; grow?: boolean }) {
  const h = useHover({ base: theme.bgElevated, hover: theme.bgHover })
  return (
    <box
      flexDirection="row"
      flexGrow={props.grow ? 1 : 0}
      gap={1}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={h.bg()}
      onMouseOver={h.onMouseOver}
      onMouseOut={h.onMouseOut}
      onMouseDown={props.onClick}
    >
      <text fg={props.fg ?? (h.hovered() ? theme.text : theme.textMuted)}>{props.label}</text>
      <Show when={props.right}>
        <box flexGrow={1} />
        <text fg={h.hovered() ? theme.text : theme.textFaint}>{props.right}</text>
      </Show>
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
    <box flexDirection="column" marginTop={1}>
      <box
        flexDirection="row"
        gap={1}
        backgroundColor={h.bg()}
        onMouseOver={h.onMouseOver}
        onMouseOut={h.onMouseOut}
        onMouseDown={props.onToggle}
      >
        {/* Reversed hierarchy: the title is the bright, bold anchor; caret + count stay faint. */}
        <text fg={h.hovered() ? theme.brand : theme.textMuted}>{props.open ? "▾" : "▸"}</text>
        <text fg={theme.text}>
          <strong>{props.label.toUpperCase()}</strong>
        </text>
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
  // Chrome panel — brand amber, never the per-mode chat accent.
  const accent = () => shimmerAccent(theme.brand)
  const [todosOpen, setTodosOpen] = createSignal(true)
  const [todosNew, setTodosNew] = createSignal(false)
  const [filesOpen, setFilesOpen] = createSignal(false)
  const [filesNew, setFilesNew] = createSignal(false)
  const [plansOpen, setPlansOpen] = createSignal(false)
  const [plansNew, setPlansNew] = createSignal(false)

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

  const mcpHover = useHover({ base: theme.bgPanel, hover: theme.bgHover })
  const skillsHover = useHover({ base: theme.bgPanel, hover: theme.bgHover })
  const contextHover = useHover({ base: theme.bgPanel, hover: theme.bgHover })
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
  // Auto-compact fires at this fraction of the window (configurable in Settings — see config.autoCompactThreshold).
  const thresholdPct = () => Math.round(app.autoCompactThreshold() * 100)
  // Usage gauge: a single filled bar (▰ used · ▱ free) with a ┊ tick marking the auto-compact column.
  // Returns cell counts so the filled/empty stretches and the tick can wear distinct colors.
  const BAR_CELLS = () => Math.max(10, Math.min(20, innerW() - 5))
  const zones = () => {
    const n = BAR_CELLS()
    const used = Math.max(0, Math.min(n, Math.round((barPct() / 100) * n)))
    const compactCol = Math.max(0, Math.min(n, Math.round(app.autoCompactThreshold() * n)))
    const over = used >= compactCol
    return {
      used,
      preTick: over ? 0 : compactCol - used, // empty cells before the tick
      postTick: over ? n - used : n - compactCol, // empty cells after the tick
      tick: !over, // hide the tick once usage has crossed the compact line (the whole bar turns warning)
      over,
    }
  }
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
        {/* No panel title — the close control sits at the right edge with its shortcut shown clearly. */}
        <box flexDirection="row" paddingRight={1} alignItems="center">
          <box flexGrow={1} />
          <CloseButton hint="ctrl+b" onClose={() => app.setRightOpen(false)} />
        </box>

        <scrollbox flexGrow={1} minHeight={0} paddingLeft={1} paddingRight={1} paddingTop={1}>
          <box flexDirection="column" gap={1}>
            {/* ── 1. MODEL ─── flat label, raised control chips ─── */}
            <box flexDirection="column" gap={0}>
              <SectionLabel text="model" />
              <Chip
                label={truncate(app.model(), innerW() - 6)}
                fg={theme.text}
                right="⌄"
                grow
                onClick={() => app.setModelModalOpen(true)}
              />
              <Show when={app.reasoningModel()}>
                <Chip label={`◇ ${app.effort()} · tap to change`} grow onClick={() => app.setEffortOpen(true)} />
              </Show>
            </box>

            {/* ── 1b. CONTEXT ─── flat label, gauge + raised compaction chips ── */}
            <box flexDirection="column" gap={0}>
              <SectionLabel text="context" />
              <Show
                when={app.contextWindow() > 0}
                fallback={
                  <text fg={theme.textFaint}>
                    {fmtTokens(app.tokens())} tokens · ${app.cost().toFixed(3)}
                  </text>
                }
              >
                {/* Usage bar + compact marker — ▰ used (accent/warning) · ▱ free · ┊ auto-compact tick. */}
                <box flexDirection="row">
                  <text fg={app.compacting() ? accent() : zones().over ? theme.warning : accent()}>
                    {"▰".repeat(zones().used)}
                  </text>
                  <text fg={theme.textFaint}>{"▱".repeat(zones().preTick)}</text>
                  <Show when={zones().tick}>
                    <text fg={theme.brandDim}>┊</text>
                  </Show>
                  <text fg={theme.textFaint}>{"▱".repeat(zones().postTick)}</text>
                  <text fg={theme.textMuted}>
                    {" "}
                    {barPct()}%{app.compacting() ? " ↻" : ""}
                  </text>
                </box>
                <text fg={theme.textFaint}>└ auto-compact {thresholdPct()}%</text>
                <text fg={theme.textFaint}>
                  {fmtTokens(app.tokens())} / {fmtTokens(app.contextWindow())} · ${app.cost().toFixed(3)}
                </text>
              </Show>
              {/* Optional usage budget (/budget): warn when tokens or $ exceed it. */}
              <Show when={app.budget()}>
                <text fg={budgetOver() ? theme.error : theme.textFaint}>
                  {budgetOver() ? `${G.warn} ` : ""}budget {budgetLabel()}
                  {budgetOver() ? " exceeded" : ""}
                </text>
              </Show>
              {/* Compaction controls: trigger, stop (while running), undo (after a compaction). */}
              <box flexDirection="row" gap={1} marginTop={1}>
                <Show
                  when={!app.compacting()}
                  fallback={<Chip label="■ stop" fg={theme.error} onClick={() => app.stopCompact()} />}
                >
                  <Chip label="↻ compact" onClick={() => app.compactNow()} />
                </Show>
                <Show when={app.canUndoCompact() && !app.compacting()}>
                  <Chip label="↶ undo" onClick={() => app.undoCompact()} />
                </Show>
              </box>
            </box>

            <Rule width={innerW()} />

            {/* ── 2. NAV — voice · settings ── */}
            <box flexDirection="column" gap={0}>
              <QuickButton label="🎙 voice" hint="Ctrl+R" onClick={() => app.toggleMic()} accent={accent()} />
              <QuickButton
                label="⚙ settings"
                hint="Ctrl+G"
                onClick={() => app.setSettingsModalOpen(true)}
                accent={accent()}
              />
            </box>

            <Rule width={innerW()} />

            {/* ── 3. MCP · SKILLS ────────────────────────────────── */}
            <box flexDirection="row" gap={1}>
              <box
                flexGrow={1}
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={mcpHover.bg()}
                onMouseOver={mcpHover.onMouseOver}
                onMouseOut={mcpHover.onMouseOut}
                onMouseDown={() => app.setMcpModalOpen(true)}
              >
                <text fg={app.mcpServers().length ? theme.success : mcpHover.hovered() ? theme.text : theme.textFaint}>
                  {G.mcp} {app.mcpServers().length} mcp
                </text>
              </box>
              <box
                flexGrow={1}
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={skillsHover.bg()}
                onMouseOver={skillsHover.onMouseOver}
                onMouseOut={skillsHover.onMouseOut}
                onMouseDown={() => app.setSkillsModalOpen(true)}
              >
                <text fg={app.skills().length ? theme.text : skillsHover.hovered() ? theme.text : theme.textFaint}>
                  {G.skill} {app.skills().length} skills
                </text>
              </box>
            </box>
            {/* Permanent, clickable — opens the context-files modal to view auto context + pin files. */}
            <box
              flexGrow={1}
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={contextHover.bg()}
              onMouseOver={contextHover.onMouseOver}
              onMouseOut={contextHover.onMouseOut}
              onMouseDown={() => app.setContextModalOpen(true)}
            >
              <text fg={app.pinnedFiles().length ? theme.brand : contextHover.hovered() ? theme.text : theme.textFaint}>
                {G.pin} {app.contextFiles().length + app.pinnedFiles().length} context
                {app.pinnedFiles().length ? ` · ${app.pinnedFiles().length} pinned` : ""}
              </text>
            </box>

            <Rule width={innerW()} />

            {/* ── 4. PLANS · TODOS · FILES ── */}
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
                      <text fg={theme.brand}>{G.modePlan}</text>
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
