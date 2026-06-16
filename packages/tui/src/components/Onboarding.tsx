import { createSignal, For } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { theme, getMode } from "@friday/shared"
import { useApp } from "../store.tsx"
import { Logo } from "./Logo.tsx"
import { Scrim } from "./Scrim.tsx"
import { motion } from "../motion/index.ts"

const TOUR: { keys: string; what: string }[] = [
  { keys: "⇧⭾", what: "cycle mode: plan · default · accept-edit · yolo" },
  { keys: "⌃k", what: "command palette (every action)" },
  { keys: "@ / ", what: "mention a file or image · run a command" },
  { keys: "⌃1–9", what: "switch between parallel sessions" },
  { keys: "esc esc", what: "undo / rewind files + conversation" },
]

/** First-run welcome: a quick tour, two toggles, then opens the model picker. */
export function Onboarding() {
  const app = useApp()
  const accent = () => getMode(app.mode()).accent
  const [reduced, setReduced] = createSignal(motion.reduced())
  const [notify, setNotify] = createSignal(process.env.FRIDAY_NO_NOTIFY !== "1")

  function connect() {
    app.setOnboardingOpen(false)
    app.setModelModalOpen(true)
  }
  function skip() {
    app.setOnboardingOpen(false)
  }
  function toggleReduced() {
    const v = !reduced()
    setReduced(v)
    motion.setReduced(v)
  }
  function toggleNotify() {
    const v = !notify()
    setNotify(v)
    process.env.FRIDAY_NO_NOTIFY = v ? "0" : "1"
  }

  useKeyboard((key) => {
    if (key.name === "return" || key.name === "enter") connect()
    else if (key.name === "escape") skip()
    else if (key.name === "m") toggleReduced()
    else if (key.name === "n") toggleNotify()
  })

  return (
    <Scrim onClose={skip}>
      <box flexDirection="column" border borderStyle="rounded" borderColor={accent()} backgroundColor={theme.bgElevated} padding={1} gap={1} width={64}>
        <box alignItems="center">
          <Logo />
        </box>
        <box alignItems="center">
          <text fg={theme.textMuted}>a new kind of terminal coding agent</text>
        </box>

        <box flexDirection="column" marginTop={1}>
          <For each={TOUR}>
            {(t) => (
              <box flexDirection="row" gap={2}>
                <box width={8}>
                  <text fg={accent()}>{t.keys}</text>
                </box>
                <text fg={theme.textMuted}>{t.what}</text>
              </box>
            )}
          </For>
        </box>

        <box flexDirection="column" marginTop={1}>
          <box flexDirection="row" gap={1} onMouseDown={toggleReduced}>
            <text fg={reduced() ? theme.success : theme.textFaint}>{reduced() ? "◉" : "○"}</text>
            <text fg={theme.textMuted}>reduced motion (m)</text>
          </box>
          <box flexDirection="row" gap={1} onMouseDown={toggleNotify}>
            <text fg={notify() ? theme.success : theme.textFaint}>{notify() ? "◉" : "○"}</text>
            <text fg={theme.textMuted}>desktop notifications (n)</text>
          </box>
        </box>

        <box flexDirection="row" justifyContent="center" marginTop={1} onMouseDown={connect}>
          <box border borderStyle="rounded" borderColor={accent()} paddingLeft={2} paddingRight={2}>
            <text fg={accent()}>connect a model ⏎</text>
          </box>
        </box>
      </box>
    </Scrim>
  )
}
