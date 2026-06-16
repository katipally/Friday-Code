import { createEffect, createSignal, For, Show, type JSX } from "solid-js"
import { theme, getMode } from "@friday/shared"
import { useApp } from "../store.tsx"
import { Reveal } from "../motion/index.ts"

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
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
  return (
    <box flexDirection="column">
      <box flexDirection="row" gap={1} onMouseDown={props.onToggle}>
        <text fg={theme.textMuted}>{props.open ? "▾" : "▸"}</text>
        <text fg={theme.textMuted}>{props.label}</text>
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
export function ContextPanel() {
  const app = useApp()
  const accent = () => getMode(app.mode()).accent
  const [todosOpen, setTodosOpen] = createSignal(false)
  const [todosNew, setTodosNew] = createSignal(false)
  const [filesOpen, setFilesOpen] = createSignal(false)
  const [filesNew, setFilesNew] = createSignal(false)

  // Auto-reveal Todos/Files when their backing data changes (signature compare).
  const todoSig = () => app.todos().map((t) => `${t.status}:${t.text}`).join("|")
  const fileSig = () =>
    [...app.changedFiles().map((f) => `${f.status}${f.path}${f.added}${f.removed}`), ...app.diagnostics().map((d) => `${d.path}${d.errors}${d.warnings}`)].join("|")
  let prevTodo: string | null = null
  let prevFile: string | null = null
  createEffect(() => {
    const sig = todoSig()
    if (prevTodo !== null && sig !== prevTodo && sig) {
      setTodosOpen(true)
      setTodosNew(true)
    }
    prevTodo = sig
  })
  createEffect(() => {
    const sig = fileSig()
    if (prevFile !== null && sig !== prevFile && sig) {
      setFilesOpen(true)
      setFilesNew(true)
    }
    prevFile = sig
  })

  const toggleTodos = () => {
    setTodosOpen(!todosOpen())
    setTodosNew(false)
  }
  const toggleFiles = () => {
    setFilesOpen(!filesOpen())
    setFilesNew(false)
  }

  const pct = () => (app.contextWindow() > 0 ? Math.min(100, Math.round((app.tokens() / app.contextWindow()) * 100)) : 0)

  return (
    <Show
      when={app.rightOpen()}
      fallback={
        <box
          width={3}
          height="100%"
          backgroundColor={theme.bgPanel}
          alignItems="center"
          paddingTop={1}
          onMouseDown={() => app.setRightOpen(true)}
        >
          <text fg={theme.textMuted}>‹</text>
        </box>
      }
    >
      <box
        width={app.rightWidth()}
        height="100%"
        flexDirection="column"
        border
        borderStyle="rounded"
        borderColor={theme.border}
        backgroundColor={theme.bgPanel}
      >
        <box flexDirection="row" paddingLeft={1} paddingRight={1} alignItems="center">
          <box onMouseDown={() => app.setRightOpen(false)}>
            <text fg={theme.textFaint}>›</text>
          </box>
          <box flexGrow={1} />
          <text fg={theme.textMuted}>stats</text>
        </box>

        <scrollbox flexGrow={1} minHeight={0} paddingLeft={1} paddingRight={1} paddingTop={1}>
          <box flexDirection="column" gap={1}>
            {/* Always-on stat block. */}
            <box flexDirection="column" onMouseDown={() => app.setModelModalOpen(true)}>
              <text fg={theme.text}>{app.model()}</text>
              <Show when={app.reasoningModel()}>
                <text fg={theme.textFaint}>◇ {app.effort()}</text>
              </Show>
            </box>

            <box flexDirection="column">
              <Show
                when={app.contextWindow() > 0}
                fallback={<text fg={theme.textFaint}>{fmtTokens(app.tokens())} tokens · ${app.cost().toFixed(3)}</text>}
              >
                <text fg={pct() > 80 ? theme.warning : accent()}>
                  {"█".repeat(Math.round((pct() / 100) * 12))}
                  {"░".repeat(12 - Math.round((pct() / 100) * 12))} {pct()}%
                </text>
                <text fg={theme.textFaint}>
                  {fmtTokens(app.tokens())}/{fmtTokens(app.contextWindow())} · ${app.cost().toFixed(3)}
                </text>
              </Show>
            </box>

            <box flexDirection="row" gap={1} onMouseDown={() => app.setMcpModalOpen(true)}>
              <text fg={app.mcpServers().length ? theme.success : theme.textFaint}>⚡ {app.mcpServers().length} mcp</text>
              <text fg={theme.textFaint}>· {app.skills().length} skills</text>
            </box>
            <Show when={app.contextFiles().length}>
              <text fg={theme.textFaint}>✓ {app.contextFiles().length} context files</text>
            </Show>

            <text fg={theme.borderMuted}>{"─".repeat(Math.max(0, app.rightWidth() - 4))}</text>

            {/* Todos — auto-reveals when the agent rewrites the task list. */}
            <Section label="todos" count={app.todos().length} open={todosOpen()} fresh={todosNew()} onToggle={toggleTodos}>
              <Show when={app.todos().length} fallback={<text fg={theme.textFaint}>none yet</text>}>
                <For each={app.todos()}>
                  {(t) => (
                    <box flexDirection="row" gap={1}>
                      <text fg={t.status === "done" ? theme.success : t.status === "active" ? accent() : theme.textFaint}>
                        {t.status === "done" ? "☑" : t.status === "active" ? "▸" : "☐"}
                      </text>
                      <text fg={t.status === "active" ? theme.text : theme.textMuted}>{t.text}</text>
                    </box>
                  )}
                </For>
              </Show>
            </Section>

            {/* Files this session modified — from its own checkpoint snapshots, plus LSP. */}
            <Section
              label="files modified"
              count={app.changedFiles().length + app.diagnostics().length}
              open={filesOpen()}
              fresh={filesNew()}
              onToggle={toggleFiles}
            >
              <Show when={app.changedFiles().length || app.diagnostics().length} fallback={<text fg={theme.textFaint}>no changes yet</text>}>
                <For each={app.changedFiles()}>
                  {(f) => (
                    <box flexDirection="row" gap={1}>
                      <text fg={theme.warning}>{f.status}</text>
                      <text fg={theme.textMuted}>{f.path}</text>
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
                      <text fg={theme.textMuted}>{d.path}</text>
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
