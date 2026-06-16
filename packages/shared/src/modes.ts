/**
 * The four interaction modes. Shift+Tab cycles them; the whole frame recolors to `accent`.
 *
 * `policy` is the default permission posture the engine applies (consumed in M2); the UI only needs
 * id/label/glyph/accent/hint for M0.
 */
export type ModeId = "plan" | "default" | "accept-edit" | "yolo"

export type PermissionPolicy = {
  /** edits to files (write/edit/multi-edit) */
  edit: "deny" | "ask" | "allow"
  /** shell commands (bash) */
  bash: "deny" | "ask" | "allow"
  /** network (webfetch/websearch) */
  network: "deny" | "ask" | "allow"
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
    id: "plan",
    label: "plan",
    glyph: "◐",
    accent: "#38bdf8", // cyan/blue
    hint: "read-only · proposes a plan, never edits",
    policy: { edit: "deny", bash: "ask", network: "ask" },
  },
  {
    id: "default",
    label: "default",
    glyph: "⬡",
    accent: "#2dd4bf", // teal/mint — Friday's signature
    hint: "asks before edits & commands",
    policy: { edit: "ask", bash: "ask", network: "ask" },
  },
  {
    id: "accept-edit",
    label: "accept edits",
    glyph: "◓",
    accent: "#f5a623", // amber/gold
    hint: "auto-applies edits · asks for bash & network",
    policy: { edit: "allow", bash: "ask", network: "ask" },
  },
  {
    id: "yolo",
    label: "yolo",
    glyph: "◆",
    accent: "#f7768e", // red/magenta
    hint: "full auto · no prompts",
    policy: { edit: "allow", bash: "allow", network: "allow" },
  },
] as const

export const DEFAULT_MODE: ModeId = "default"

export function getMode(id: ModeId): Mode {
  return MODES.find((m) => m.id === id) ?? MODES[1]!
}

export function cycleMode(id: ModeId, dir: 1 | -1 = 1): ModeId {
  const i = MODES.findIndex((m) => m.id === id)
  const next = (i + dir + MODES.length) % MODES.length
  return MODES[next]!.id
}
