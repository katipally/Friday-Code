import { render } from "@opentui/solid"
import type { Engine } from "@friday/core"
import { App } from "./App.tsx"

/** Boot the Friday Code TUI (full-screen, mouse on) against an engine. */
export function start(engine: Engine): void {
  render(() => <App engine={engine} />, {
    targetFPS: 60,
    exitOnCtrlC: true,
    useMouse: true,
    autoFocus: true,
  })
}
