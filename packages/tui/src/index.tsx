import type { Engine } from "@friday/core"
import { applyTerminalProfile, applyTheme } from "@friday/shared"
import { render } from "@opentui/solid"
import { App } from "./App.tsx"
import { hasTruecolor } from "./util/term.ts"
import { probeTerminal } from "./util/terminal.ts"

/** Boot the Friday Code TUI (full-screen, mouse on) against an engine. */
export async function start(engine: Engine, version = "dev"): Promise<void> {
  // Friday is dark-only. We still probe the terminal so we can layer a 256-safe palette when it
  // lacks truecolor (Terminal.app) — that keeps greys/borders/accents identical to a truecolor term.
  const saved = engine.userConfig().theme
  const profile = await probeTerminal()
  void profile.background // dark-only: background detection no longer selects a light preset
  const themeName = saved ?? "dark"
  applyTheme(themeName)
  applyTerminalProfile({ truecolor: hasTruecolor, themeName })
  render(() => <App engine={engine} version={version} />, {
    targetFps: 60,
    exitOnCtrlC: false, // we handle Ctrl+C to show the clean-exit screen
    useMouse: true,
    autoFocus: true,
  })
}
