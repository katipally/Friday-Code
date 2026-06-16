import { onCleanup, onMount, Show } from "solid-js"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { theme, getMode, MASCOT } from "@friday/shared"
import type { SessionStats } from "@friday/core"
import { useApp } from "../store.tsx"
import { Logo } from "./Logo.tsx"

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}
function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

/** Clean-exit screen: animated logo + mascot + session stats + resume command. */
export function ExitScreen() {
  const app = useApp()
  const renderer = useRenderer()
  const accent = () => getMode(app.mode()).accent
  const stats = app.exitStats()
  const id = app.engine.currentSessionId()
  const title = app.engine.currentTitle()
  const empty = app.engine.currentIsEmpty()

  let done = false
  function finalize() {
    if (done) return
    done = true
    app.engine.dispose() // close MCP + discard empty placeholder sessions so history stays clean
    renderer.destroy()
    // Printed to the normal screen so it stays in scrollback after the TUI exits.
    // Skip the resume hint for an empty session — it's discarded on dispose.
    const resume = empty ? "" : `\n  resume:  friday -s ${id}`
    process.stdout.write(`\n  friday — "${title}"${resume}\n\n`)
  }

  onMount(() => {
    const t = setTimeout(finalize, 2200)
    onCleanup(() => clearTimeout(t))
  })
  useKeyboard(() => finalize())

  return (
    <box
      width="100%"
      height="100%"
      backgroundColor={theme.bg}
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
      gap={1}
    >
      <Logo />
      <text fg={accent()}>{MASCOT.done.frames[0]} see you soon</text>
      <box height={1} />
      <Show when={stats}>
        {(s: () => SessionStats) => (
          <text fg={theme.textMuted}>
            {s().messages} messages · {fmtTokens(s().tokens)} tokens · {fmtDuration(s().durationMs)}
          </text>
        )}
      </Show>
      <box flexDirection="row" gap={1}>
        <text fg={theme.textFaint}>resume:</text>
        <text fg={theme.text}>friday -s {id.slice(0, 8)}…</text>
      </box>
      <box height={1} />
      <text fg={theme.textFaint}>press any key to exit</text>
    </box>
  )
}
