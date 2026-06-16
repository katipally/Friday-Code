import { createSignal, For, Show, type JSX } from "solid-js"
import { theme, getMode } from "@friday/shared"
import { useApp } from "../store.tsx"
import { Reveal } from "../motion/index.ts"

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

/** A collapsible accordion section with an animated chevron + revealed body. */
function Section(props: { label: string; count?: number; open: boolean; onToggle: () => void; children: JSX.Element }) {
  return (
    <box flexDirection="column">
      <box flexDirection="row" gap={1} onMouseDown={props.onToggle}>
        <text fg={theme.textMuted}>{props.open ? "▾" : "▸"}</text>
        <text fg={theme.textMuted}>{props.label}</text>
        <Show when={props.count != null}>
          <text fg={theme.textFaint}>({props.count})</text>
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

/** Right panel: stacked collapsible accordions — Todos / Files / Context. */
export function ContextPanel() {
  const app = useApp()
  const accent = () => getMode(app.mode()).accent
  const [todosOpen, setTodosOpen] = createSignal(true)
  const [filesOpen, setFilesOpen] = createSignal(true)
  const [ctxOpen, setCtxOpen] = createSignal(false)

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
          <text fg={theme.textMuted}>workspace</text>
        </box>

        <scrollbox flexGrow={1} minHeight={0} paddingLeft={1} paddingRight={1} paddingTop={1}>
          <box flexDirection="column" gap={1}>
            {/* Todos — populated by the todo_write tool (M9). */}
            <Section label="todos" count={app.todos().length} open={todosOpen()} onToggle={() => setTodosOpen(!todosOpen())}>
              <Show
                when={app.todos().length}
                fallback={<text fg={theme.textFaint}>none yet</text>}
              >
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

            {/* Modified files (git, M12) + LSP diagnostics (M11). */}
            <Section
              label="files"
              count={app.changedFiles().length + app.diagnostics().length}
              open={filesOpen()}
              onToggle={() => setFilesOpen(!filesOpen())}
            >
              <Show when={app.branch()}>
                <text fg={theme.textFaint}> {app.branch()}</text>
              </Show>
              <Show when={app.changedFiles().length || app.diagnostics().length} fallback={<text fg={theme.textFaint}>no changes</text>}>
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

            {/* Context — FRIDAY.md, model, tokens, skills, MCP, active tools. */}
            <Section label="context" open={ctxOpen()} onToggle={() => setCtxOpen(!ctxOpen())}>
              <box flexDirection="column" gap={1}>
                <box flexDirection="column">
                  <text fg={theme.textMuted}>context files</text>
                  <Show when={app.contextFiles().length} fallback={<text fg={theme.textFaint}>none (add FRIDAY.md)</text>}>
                    <For each={app.contextFiles()}>{(f) => <text fg={theme.success}>✓ {f}</text>}</For>
                  </Show>
                </box>
                <box flexDirection="column">
                  <text fg={theme.textMuted}>context</text>
                  <Show
                    when={app.contextWindow() > 0}
                    fallback={<text fg={theme.textFaint}>{fmtTokens(app.tokens())} tokens · ${app.cost().toFixed(3)}</text>}
                  >
                    {(() => {
                      const pct = () => Math.min(100, Math.round((app.tokens() / app.contextWindow()) * 100))
                      const filled = () => Math.round((pct() / 100) * 12)
                      return (
                        <box flexDirection="column">
                          <text fg={pct() > 80 ? theme.warning : accent()}>
                            {"█".repeat(filled())}
                            {"░".repeat(12 - filled())} {pct()}%
                          </text>
                          <text fg={theme.textFaint}>
                            {fmtTokens(app.tokens())}/{fmtTokens(app.contextWindow())} · ${app.cost().toFixed(3)}
                          </text>
                        </box>
                      )
                    })()}
                  </Show>
                </box>
                <box flexDirection="column">
                  <text fg={theme.textMuted}>model</text>
                  <text fg={theme.textFaint}>{app.model()}</text>
                </box>
                <Show when={app.skills().length}>
                  <box flexDirection="column">
                    <text fg={theme.textMuted}>skills</text>
                    <For each={app.skills()}>{(s) => <text fg={theme.textFaint}>• {s.name}</text>}</For>
                  </box>
                </Show>
                <box flexDirection="column" onMouseDown={() => app.setMcpModalOpen(true)}>
                  <text fg={theme.textMuted}>mcp ＋</text>
                  <Show when={app.mcpServers().length} fallback={<text fg={theme.textFaint}>none · /mcp</text>}>
                    <For each={app.mcpServers()}>{(s) => <text fg={theme.success}>⚡ {s}</text>}</For>
                  </Show>
                </box>
                <Show when={app.runningTools().length}>
                  <box flexDirection="column">
                    <text fg={theme.textMuted}>active</text>
                    <For each={app.runningTools()}>{(t) => <text fg={theme.warning}>⟳ {t}</text>}</For>
                  </box>
                </Show>
              </box>
            </Section>
          </box>
        </scrollbox>
      </box>
    </Show>
  )
}
