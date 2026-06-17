import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import { theme, getMode, MASCOT, type MascotState } from "@friday/shared"
import { useApp } from "../store.tsx"
import { Pressable } from "./Pressable.tsx"
import { useMascotFrame } from "../util/useMascot.ts"
import { useBreathe } from "../motion/index.ts"

/**
 * Strip directly above the composer: the animated mascot + live status on the left, an elapsed
 * timer and a Stop control in the middle, and the active model pinned to the far right.
 * (Token usage + cost live in the context side panel, not here.)
 */
export function StatusStrip() {
  const app = useApp()
  // Effective mascot state: a pending permission/question makes Friday "wait" regardless of the
  // engine's last mascot event, so the face reads the moment-to-moment situation.
  const mstate = (): MascotState => (app.pending() || app.askPending() ? "waiting" : app.mascot())
  // Mood tint: error→red, done→green, waiting→amber, otherwise the current mode's accent.
  const moodAccent = () => {
    const s = mstate()
    if (s === "error") return theme.error
    if (s === "done") return theme.success
    if (s === "waiting") return theme.warning
    return getMode(app.mode()).accent
  }
  const frame = useMascotFrame(mstate)
  const glow = useBreathe(moodAccent, () => app.busy() || mstate() === "waiting")
  // Always-on personality line — shown when idle/done/waiting/error; the factual engine status
  // takes over while busy (so tool names etc. stay visible).
  const mascotLine = () => MASCOT[mstate()].line ?? "ready"

  // Tick a clock while busy so the elapsed timer + tokens/sec update live. We `untrack`
  // tokens inside the effect so it depends ONLY on busy — otherwise the effect re-ran on
  // every streamed token and reset `startedAt`, which made the timer jump around (the glitch).
  const [tick, setTick] = createSignal(0)
  const [frozen, setFrozen] = createSignal<number | null>(null)
  let startedAt = 0
  createEffect(() => {
    if (!app.busy()) {
      // Capture the final elapsed once when the turn settles, so a stopped/done run shows a
      // frozen time instead of vanishing — clear, "did it actually stop?" feedback.
      if (startedAt) {
        setFrozen((Date.now() - startedAt) / 1000)
        startedAt = 0
      }
      return
    }
    startedAt = Date.now()
    setFrozen(null)
    const iv = setInterval(() => setTick((t) => t + 1), 250)
    onCleanup(() => clearInterval(iv))
  })
  const elapsedS = () => (app.busy() ? (tick(), (Date.now() - startedAt) / 1000) : 0)
  const stopped = () => !app.busy() && app.status() === "stopped" && frozen() != null

  return (
    <box flexDirection="row" height={1} paddingLeft={1} paddingRight={1} gap={1} alignItems="center">
      <text fg={glow()}>{frame()}</text>
      <Show when={stopped()} fallback={<text fg={app.busy() ? theme.text : theme.textMuted}>{app.busy() ? app.status() : mascotLine()}</text>}>
        <text fg={theme.textFaint}>stopped</text>
      </Show>
      {/* elapsed — plain text (no emoji glyph, which renders double-width and overlaps the digits). */}
      <Show when={app.busy() && elapsedS() > 0}>
        <text fg={theme.textFaint}>{elapsedS().toFixed(1)}s</text>
      </Show>
      <Show when={stopped()}>
        <text fg={theme.textFaint}>{frozen()!.toFixed(1)}s</text>
      </Show>
      {/* A clickable Stop button — a reliable way to abort when a fast stream makes the keyboard
          feel unresponsive. Clicking aborts immediately; Esc still works as the keyboard path. */}
      <Show when={app.busy()}>
        <box
          onMouseDown={() => app.abort()}
          backgroundColor={app.stopArmed() ? theme.warning : theme.bgElevated}
          paddingLeft={1}
          paddingRight={1}
        >
          <text fg={app.stopArmed() ? theme.bg : theme.error}>■ stop{app.stopArmed() ? " · esc again" : " · esc"}</text>
        </box>
      </Show>
      <box flexGrow={1} />
      {/* Cost + token usage live in the side panel (stats); the rail stays a calm status line. */}
      <box flexDirection="row" alignItems="center">
        <Pressable label={app.model()} fg={theme.textMuted} onClick={() => app.setModelModalOpen(true)} />
        <Show when={app.reasoningModel()}>
          <Pressable label={`◇ ${app.effort()}`} onClick={() => app.setEffortOpen(true)} />
        </Show>
      </box>
    </box>
  )
}
