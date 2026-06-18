/**
 * Friday the mascot — a compact, single-line animated robot that lives in the status strip above
 * the composer. Each state is an array of frames cycled at `interval` ms by the UI's timeline.
 *
 * Keep every frame the SAME visual width so the status strip never jitters.
 */
export type MascotState = "idle" | "thinking" | "streaming" | "working" | "done" | "error" | "waiting"

export interface MascotAnim {
  frames: string[]
  /** ms per frame */
  interval: number
  /** a short personality line the UI may show on entering this state (optional) */
  line?: string
}

/**
 * Friday's expressions. Keep every frame WITHIN a state the same visual width so the strip never
 * jitters. Idle bakes in occasional blinks and side-glances (mostly-neutral frames with sparse
 * specials), done "pops" then settles, and error "shakes" by shifting within a fixed width.
 */
export const MASCOT: Record<MascotState, MascotAnim> = {
  idle: {
    frames: ["⬡‿⬡", "⬡‿⬡", "⬡‿⬡", "⬡-⬡", "⬡‿⬡", "⬡‿⬡", "⬡‿⬡", "◂‿⬡", "⬡‿⬡", "⬡‿⬡", "⬡‿⬡", "⬡‿▸"],
    interval: 600,
    line: "ready",
  },
  thinking: { frames: ["⬡⌄⬡", "⬡◞⬡", "⬡◡⬡", "⬡◟⬡"], interval: 140, line: "thinking…" },
  streaming: { frames: ["[>‿<]", "[>◡<]", "[>‿<]", "[>ᵕ<]"], interval: 120, line: "streaming…" },
  working: { frames: ["⬡▰⬡", "⬡▱⬡", "⬡▰⬡", "⬡▱⬡"], interval: 160, line: "on it!" },
  done: { frames: ["\\⬡‿⬡/", " ⬡‿⬡ "], interval: 320, line: "done!" },
  error: { frames: [" ⬡_⬡", "⬡_⬡ ", " ⬡╴⬡", "⬡╴⬡ "], interval: 110, line: "hmm…" },
  waiting: { frames: ["⬡⊙⬡", "⬡⊙⬡", "⬡◎⬡"], interval: 500, line: "your call" },
}
