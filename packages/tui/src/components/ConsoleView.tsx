import { theme } from "@friday/shared"
import { useKeyboard } from "@opentui/solid"
import { createSignal, For, Show } from "solid-js"
import { type TeamMember, useApp, type ViewItem } from "../store.tsx"
import { bandBg, SectionLabel } from "./ui.tsx"

/** Status → dot glyph + color. */
export function dot(status: string): { g: string; c: string } {
  switch (status) {
    case "running":
      return { g: "●", c: theme.info }
    case "done":
      return { g: "✓", c: theme.success }
    case "dead":
      return { g: "✗", c: theme.error }
    case "timed-out":
      return { g: "⌛", c: theme.warning }
    default:
      return { g: "○", c: theme.textMuted }
  }
}

/** Flatten a transcript item to a short one-liner for the watch tail. */
export function line(it: ViewItem): { text: string; c: string } {
  switch (it.kind) {
    case "user":
      return { text: `› ${it.display ?? it.text}`, c: theme.user }
    case "assistant":
      return { text: it.text || (it.done ? "" : "…"), c: theme.text }
    case "tool":
      return { text: `⚙ ${it.name}${it.title ? `: ${it.title}` : ""}`, c: theme.textMuted }
    case "error":
      return { text: `✗ ${it.text}`, c: theme.error }
    case "notice":
      return { text: it.text, c: theme.textFaint }
    case "breaker":
      return { text: `— ${it.label} —`, c: theme.textFaint }
    case "inject":
      return { text: `＋ ${it.text}`, c: theme.textFaint }
  }
}

/**
 * The agent-team console: a full-screen cockpit over the shared board. Left rail lists the team
 * roster (role · status · activity); the right pane shows the shared board (findings/handoffs +
 * file claims) on top and a live tail of the selected agent's transcript below.
 *
 * Keys: j/k or ↑/↓ select · v/⏎ visit (open that agent's session) · s stop · o pop out to a real
 * terminal window · esc back to chat.
 */
export function ConsoleView() {
  const app = useApp()
  const [sel, setSel] = createSignal(0)

  const members = (): TeamMember[] => app.team()?.members ?? []
  const clampedSel = () => Math.min(sel(), Math.max(0, members().length - 1))
  const selected = (): TeamMember | undefined => members()[clampedSel()]
  const tail = (): ViewItem[] => {
    const sid = selected()?.sessionId
    const items = sid ? (app.sessionItems[sid] ?? []) : []
    return items.slice(-12)
  }

  useKeyboard((key) => {
    if (app.view() !== "console") return
    const n = members().length
    if (key.name === "escape") return app.setView("shell")
    if (key.name === "j" || key.name === "down") return setSel((s) => Math.min(n - 1, s + 1))
    if (key.name === "k" || key.name === "up") return setSel((s) => Math.max(0, s - 1))
    const m = selected()
    if (!m) return
    if (key.name === "v" || key.name === "return" || key.name === "enter") return app.visitAgent(m.sessionId)
    if (key.name === "s") return app.stopAgent(m.sessionId)
    if (key.name === "o") return app.popoutAgent(m.sessionId)
  })

  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={theme.bgPanel} paddingLeft={1} paddingRight={1}>
      {/* header */}
      <box flexDirection="row" gap={1} paddingTop={1} paddingBottom={1}>
        <text fg={theme.brand}>
          <strong>▣ AGENT CONSOLE</strong>
        </text>
        <box flexGrow={1} />
        <Show when={app.team()} fallback={<text fg={theme.textFaint}>no active team</text>}>
          <text fg={theme.textMuted}>
            {app.team()!.goal} · [{app.team()!.status}]
          </text>
        </Show>
      </box>

      <Show
        when={app.team() && members().length}
        fallback={
          <box flexGrow={1} alignItems="center" justifyContent="center">
            <text fg={theme.textFaint}>
              No team running. Ask Friday to spawn_team a goal with roles, or press esc to go back.
            </text>
          </box>
        }
      >
        <box flexDirection="row" flexGrow={1} gap={1}>
          {/* left rail — roster */}
          <box flexDirection="column" width={34} backgroundColor={theme.bgElevated} paddingLeft={1} paddingRight={1}>
            <SectionLabel text={`ROSTER (${members().length})`} />
            <For each={members()}>
              {(m, i) => {
                const d = dot(m.status)
                const on = () => i() === clampedSel()
                return (
                  <box flexDirection="column" backgroundColor={bandBg(on())} onMouseDown={() => setSel(i())}>
                    <box flexDirection="row" gap={1}>
                      <text fg={on() ? theme.textOnAccent : d.c}>{d.g}</text>
                      <text fg={on() ? theme.textOnAccent : theme.textMuted}>{m.role}</text>
                      <box flexGrow={1} />
                      <text fg={on() ? theme.textOnAccent : theme.textFaint}>{m.status}</text>
                    </box>
                    <Show when={m.activity}>
                      <text fg={on() ? theme.textOnAccent : theme.textFaint}>{`  ${m.activity}`.slice(0, 30)}</text>
                    </Show>
                  </box>
                )
              }}
            </For>
            <box flexGrow={1} />
            <text fg={theme.textFaint}>j/k move · ⏎ visit</text>
            <text fg={theme.textFaint}>s stop · o pop-out · esc</text>
          </box>

          {/* right pane — board (top) + watch tail (bottom) */}
          <box flexDirection="column" flexGrow={1} gap={1}>
            <box
              flexDirection="column"
              flexGrow={1}
              backgroundColor={theme.bgElevated}
              paddingLeft={1}
              paddingRight={1}
            >
              <SectionLabel text="SHARED BOARD" />
              <Show when={app.team()!.posts.length} fallback={<text fg={theme.textFaint}>(no posts yet)</text>}>
                <For each={app.team()!.posts.slice(-12)}>
                  {(p) => (
                    <text
                      fg={p.kind === "finding" ? theme.success : p.kind === "handoff" ? theme.warning : theme.textMuted}
                    >
                      {`${p.role} ${p.kind}${p.toRole ? `→${p.toRole}` : ""}: ${p.text}`.slice(0, 200)}
                    </text>
                  )}
                </For>
              </Show>
              <Show when={app.team()!.claims.length}>
                <text fg={theme.textFaint}>
                  {`claimed: ${app
                    .team()!
                    .claims.map((c) => c.path)
                    .join(", ")}`.slice(0, 120)}
                </text>
              </Show>
            </box>

            <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1}>
              <text fg={theme.textFaint}>watching: {selected()?.role ?? "—"} (v to open full session)</text>
              <Show when={tail().length} fallback={<text fg={theme.textFaint}>(no output yet)</text>}>
                <For each={tail()}>
                  {(it) => {
                    const l = line(it)
                    return <text fg={l.c}>{l.text.replace(/\n/g, " ").slice(0, 200)}</text>
                  }}
                </For>
              </Show>
            </box>
          </box>
        </box>
      </Show>
    </box>
  )
}
