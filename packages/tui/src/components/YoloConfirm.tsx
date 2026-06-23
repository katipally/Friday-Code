import { getMode, theme } from "@friday/shared"
import { useKeyboard } from "@opentui/solid"
import { Show } from "solid-js"
import { shimmerAccent } from "../motion/index.ts"
import { useApp } from "../store.tsx"
import { G } from "../util/term.ts"
import { Scrim } from "./Scrim.tsx"
import { Overlay } from "./ui.tsx"

/**
 * Confirmation gate for entering yolo mode. yolo grants blanket approval — file edits, shell,
 * browser, and desktop control all run with NO prompts — so we never enter it on an accidental
 * Shift+Tab. Enter/y confirms, Esc/n cancels (stays on the current mode).
 */
export function YoloConfirm() {
  const app = useApp()
  const accent = () => getMode("yolo").accent

  useKeyboard((key) => {
    if (!app.yoloConfirmOpen()) return
    if (key.name === "y" || key.name === "return" || key.name === "enter") return app.confirmYolo()
    if (key.name === "n" || key.name === "escape") return app.cancelYolo()
  })

  return (
    <Show when={app.yoloConfirmOpen()}>
      <Scrim onClose={() => app.cancelYolo()}>
        <Overlay width={60}>
          {/* Danger gate — semantic yolo red header, no brand-amber title. */}
          <text fg={shimmerAccent(accent())}>
            <strong>{G.warn} ENTER YOLO MODE?</strong>
          </text>
          <text fg={theme.text}>
            yolo runs everything with NO confirmation — file edits, shell commands, browser control, and desktop
            (mouse/keyboard) actions all execute automatically.
          </text>
          <text fg={theme.textMuted}>Only use this when you trust the task. You can leave with Shift+Tab.</text>
          <box flexDirection="row" gap={1}>
            <box paddingLeft={1} paddingRight={1} backgroundColor={accent()} onMouseDown={() => app.confirmYolo()}>
              <text fg={theme.textOnAccent}>
                <strong>y</strong> enable yolo
              </text>
            </box>
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={theme.bgComposer}
              onMouseDown={() => app.cancelYolo()}
            >
              <text fg={theme.textMuted}>
                <strong>n</strong> cancel
              </text>
            </box>
          </box>
          <text fg={theme.textFaint}>y/⏎ enable · n/esc cancel</text>
        </Overlay>
      </Scrim>
    </Show>
  )
}
