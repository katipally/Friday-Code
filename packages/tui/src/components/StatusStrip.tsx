import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import { theme, getMode } from "@friday/shared"
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
  const accent = () => getMode(app.mode()).accent
  const frame = useMascotFrame(app.mascot)
  const glow = useBreathe(accent, app.busy)

  // Tick a clock while busy so the elapsed timer + tokens/sec update live.
  const [tick, setTick] = createSignal(0)
  let startedAt = 0
  let tokensAtStart = 0
  createEffect(() => {
    if (!app.busy()) return
    startedAt = Date.now()
    tokensAtStart = app.tokens()
    const iv = setInterval(() => setTick((t) => t + 1), 250)
    onCleanup(() => clearInterval(iv))
  })
  const elapsedS = () => (app.busy() ? (tick(), (Date.now() - startedAt) / 1000) : 0)
  const rate = () => {
    const s = elapsedS()
    return s > 0.5 ? Math.round((app.tokens() - tokensAtStart) / s) : 0
  }

  return (
    <box flexDirection="row" height={1} paddingLeft={1} paddingRight={1} gap={1} alignItems="center">
      <text fg={glow()}>{frame()}</text>
      <text fg={app.busy() ? theme.text : theme.textMuted}>{app.status()}</text>
      <Show when={app.busy() && elapsedS() > 0}>
        <text fg={theme.textFaint}>⏱{elapsedS().toFixed(1)}s</text>
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
        <text fg={theme.textFaint}>· esc to stop</text>
      </Show>
      <box flexGrow={1} />
      <box flexDirection="row" gap={1} alignItems="center" onMouseDown={() => app.setModelModalOpen(true)}>
        <text fg={theme.textMuted}>{app.model()}</text>
        <Show when={app.reasoningModel()}>
          <text fg={theme.textFaint}>◇ {app.effort()}</text>
        </Show>
      </box>
    </box>
  )
}
