/**
 * The four interaction modes. Shift+Tab cycles them; the whole frame recolors to `accent`.
 *
 * `policy` is the default permission posture the engine applies (consumed in M2); the UI only needs
 * id/label/glyph/accent/hint for M0.
 */
export type ModeId = "plan" | "default" | "yolo"

export type PermissionPolicy = {
  /** edits to files (write/edit/multi-edit) */
  edit: "deny" | "ask" | "allow"
  /** shell commands (bash) */
  bash: "deny" | "ask" | "allow"
  /** network (webfetch/websearch) */
  network: "deny" | "ask" | "allow"
  /** browser automation (navigate/click/type via CDP) */
  browser: "deny" | "ask" | "allow"
  /** desktop control (mouse/keyboard/screenshot) */
  computer: "deny" | "ask" | "allow"
}

export interface Mode {
  id: ModeId
  label: string
  glyph: string
  accent: string
  hint: string
  policy: PermissionPolicy
}

export const MODES: readonly Mode[] = [
  {
    id: "default",
    label: "default",
    glyph: "◈", // guarded — asks before edits & commands
    accent: "#87afd7", // slate blue-grey — neutral & calm; exact xterm-256 cube member (110) so it renders the same hue on Terminal.app
    hint: "asks before edits & commands",
    policy: { edit: "ask", bash: "ask", network: "ask", browser: "ask", computer: "ask" },
  },
  {
    id: "plan",
    label: "plan",
    glyph: "◐",
    accent: "#5fafff", // cyan/blue — exact xterm-256 cube member (75)
    hint: "read-only · proposes a plan you review, then run",
    policy: { edit: "deny", bash: "ask", network: "ask", browser: "ask", computer: "ask" },
  },
  {
    id: "yolo",
    label: "yolo",
    glyph: "⚡", // full auto — no prompts
    accent: "#ff5f5f", // red — danger/full-auto; distinct from the amber Friday brand chrome; exact xterm-256 cube member (203)
    hint: "full auto · no prompts",
    policy: { edit: "allow", bash: "allow", network: "allow", browser: "allow", computer: "allow" },
  },
] as const

export const DEFAULT_MODE: ModeId = "default"

export function getMode(id: ModeId): Mode {
  return MODES.find((m) => m.id === id) ?? MODES[0]!
}

export function cycleMode(id: ModeId, dir: 1 | -1 = 1): ModeId {
  const i = MODES.findIndex((m) => m.id === id)
  const next = (i + dir + MODES.length) % MODES.length
  return MODES[next]!.id
}
