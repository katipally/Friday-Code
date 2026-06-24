import type { Engine } from "@friday/core"
import { applyTerminalProfile, applyTheme } from "@friday/shared"
import { render } from "@opentui/solid"
import { App } from "./App.tsx"
import { hasTruecolor } from "./util/term.ts"
import { probeTerminal } from "./util/terminal.ts"

/** Boot the Friday Code TUI (full-screen, mouse on) against an engine. `initialView` opens straight
 * into the dashboard or team console (used when a chip/button launches one in its own terminal). */
export async function start(
  engine: Engine,
  version = "dev",
  initialView?: "dashboard" | "console",
): Promise<void> {
  // Friday is dark-only. We still probe the terminal so we can layer a 256-safe palette when it
  // lacks truecolor (Terminal.app) — that keeps greys/borders/accents identical to a truecolor term.
  const saved = engine.userConfig().theme
  const profile = await probeTerminal()
  void profile.background // dark-only: background detection no longer selects a light preset
  const themeName = saved ?? "dark"
  applyTheme(themeName)
  applyTerminalProfile({ truecolor: hasTruecolor, themeName })
  render(() => <App engine={engine} version={version} initialView={initialView} />, {
    targetFps: 60,
    exitOnCtrlC: false, // we handle Ctrl+C to show the clean-exit screen
    useMouse: true,
    autoFocus: true,
    // Kitty keyboard protocol: negotiated via a query/response handshake — terminals that don't
    // support it (Terminal.app) simply ignore it, so this is safe everywhere. Where supported
    // (kitty, WezTerm, Ghostty, modern iTerm2) it delivers chords legacy terminals can't encode:
    // Shift+Enter, Cmd/Super+Enter (pause), and disambiguated Esc. `disambiguate` also fixes the
    // alt-vs-meta ambiguity and ESC timing.
    useKittyKeyboard: { disambiguate: true, alternateKeys: true },
  })
}
