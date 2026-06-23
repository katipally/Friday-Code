import { getMode, MASCOT, type MascotState, theme } from "@friday/shared"
import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import { useBreathe } from "../motion/index.ts"
import { useApp } from "../store.tsx"
import { useMascotFrame } from "../util/useMascot.ts"
import { Pressable } from "./Pressable.tsx"

/** Spell a chord string ("shift+escape") into proper Title-case key names ("Shift+Esc"). */
function fmtChord(chord: string): string {
  const name = (p: string) =>
    p === "ctrl"
      ? "Ctrl"
      : p === "shift"
        ? "Shift"
        : p === "option" || p === "alt"
          ? "Alt"
          : p === "meta" || p === "cmd"
            ? "Cmd"
            : p === "escape"
              ? "Esc"
              : p === "return"
                ? "Enter"
                : p.length <= 1
                  ? p.toUpperCase()
                  : p.charAt(0).toUpperCase() + p.slice(1)
  return chord.split("+").map(name).join("+")
}

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
  // Mood tint: error→red, done→green, waiting→amber, otherwise the CURRENT MODE's accent — the
  // mascot sits above the composer and reflects the active mode (plan/default/yolo) so the mood
  // colour matches the mode you're about to run in.
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
  const elapsedS = () => {
    if (!app.busy()) return 0
    tick() // subscribe to the ticker so elapsed time re-computes each interval
    return (Date.now() - startedAt) / 1000
  }
  const stopped = () => !app.busy() && app.status() === "stopped" && frozen() != null

  return (
    <box flexDirection="row" height={1} paddingLeft={1} paddingRight={1} gap={1} alignItems="center">
      <text fg={glow()}>{frame()}</text>
      <Show
        when={stopped()}
        fallback={
          <text fg={app.busy() ? theme.text : theme.textMuted}>{app.busy() ? app.status() : mascotLine()}</text>
        }
      >
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
        {/* Pause — opens the /pause modal so you can course-correct the running agent by adding context.
            The shown key mirrors the (rebindable) pause.open binding, default Shift+Esc. */}
        <box
          onMouseDown={() => app.runCommand("pause")}
          backgroundColor={theme.bgElevated}
          paddingLeft={1}
          paddingRight={1}
        >
          <text fg={theme.warning}>⏸ Pause · {fmtChord(app.keymap()["pause.open"])}</text>
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
