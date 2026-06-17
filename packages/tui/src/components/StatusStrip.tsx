import { createEffect, createSignal, onCleanup, Show, untrack } from "solid-js"
import { theme, getMode, MASCOT, type MascotState } from "@friday/shared"
import { useApp } from "../store.tsx"
import { useMascotFrame } from "../util/useMascot.ts"
import { useBreathe } from "../motion/index.ts"

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

/**
 * Strip directly above the composer: the animated mascot + live status on the left,
 * a live elapsed/token meter in the middle, and the active model pinned to the far right.
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
  let tokensAtStart = 0
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
    tokensAtStart = untrack(() => app.tokens())
    setFrozen(null)
    const iv = setInterval(() => setTick((t) => t + 1), 250)
    onCleanup(() => clearInterval(iv))
  })
  const elapsedS = () => (app.busy() ? (tick(), (Date.now() - startedAt) / 1000) : 0)
  const rate = () => {
    const s = elapsedS()
    return s > 0.5 ? Math.round((app.tokens() - tokensAtStart) / s) : 0
  }
  const stopped = () => !app.busy() && app.status() === "stopped" && frozen() != null

  return (
    <box flexDirection="row" height={1} paddingLeft={1} paddingRight={1} gap={1} alignItems="center">
      <text fg={glow()}>{frame()}</text>
      <Show when={stopped()} fallback={<text fg={app.busy() ? theme.text : theme.textMuted}>{app.busy() ? app.status() : mascotLine()}</text>}>
        <text fg={theme.textFaint}>⏹ stopped</text>
      </Show>
      <Show when={app.busy() && elapsedS() > 0}>
        <text fg={theme.textFaint}>⏱{elapsedS().toFixed(1)}s</text>
      </Show>
      <Show when={stopped()}>
        <text fg={theme.textFaint}>⏱{frozen()!.toFixed(1)}s</text>
      </Show>
      <Show when={app.tokens() > 0}>
        <text fg={theme.textFaint}>· {fmtTokens(app.tokens())} tok</text>
      </Show>
      <Show when={app.busy() && rate() > 0}>
        <text fg={theme.textFaint}>· {rate()}/s</text>
      </Show>
      <Show when={app.cost() > 0}>
        <text fg={theme.textFaint}>· ${app.cost() < 0.01 ? app.cost().toFixed(4) : app.cost().toFixed(2)}</text>
      </Show>
      <Show when={app.busy()}>
        <Show when={app.stopArmed()} fallback={<text fg={theme.textFaint}>· esc to stop</text>}>
          <text fg={theme.warning}>· ⚠ press esc again to stop</text>
        </Show>
      </Show>
      <box flexGrow={1} />
      <box flexDirection="row" gap={1} alignItems="center">
        <box onMouseDown={() => app.setModelModalOpen(true)}>
          <text fg={theme.textMuted}>{app.model()}</text>
        </box>
        <Show when={app.reasoningModel()}>
          <box onMouseDown={() => app.setEffortOpen(true)}>
            <text fg={theme.textFaint}>◇ {app.effort()}</text>
          </box>
        </Show>
      </box>
    </box>
  )
}
