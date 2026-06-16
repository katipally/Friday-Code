/**
 * Friday the mascot — a compact, single-line animated robot that lives in the status strip above
 * the composer. Each state is an array of frames cycled at `interval` ms by the UI's timeline.
 *
 * Keep every frame the SAME visual width so the status strip never jitters.
 */
export type MascotState = "idle" | "thinking" | "streaming" | "working" | "done" | "error"

export interface MascotAnim {
  frames: string[]
  /** ms per frame */
  interval: number
  /** a short personality line the UI may show on entering this state (optional) */
  line?: string
}

export const MASCOT: Record<MascotState, MascotAnim> = {
  idle: { frames: ["⬡◡⬡", "⬡‿⬡", "⬡◡⬡", "⬡-⬡"], interval: 600 },
  thinking: { frames: ["⬡⌄⬡", "⬡◞⬡", "⬡◡⬡", "⬡◟⬡"], interval: 140, line: "thinking…" },
  streaming: { frames: ["[>‿<]", "[>◡<]", "[>‿<]", "[>ᵕ<]"], interval: 120 },
  working: { frames: ["⬡▰⬡", "⬡▱⬡", "⬡▰⬡", "⬡▱⬡"], interval: 160, line: "on it!" },
  done: { frames: ["⬡‿⬡"], interval: 1000, line: "done!" },
  error: { frames: ["⬡_⬡", "⬡╴⬡"], interval: 400, line: "hmm…" },
}
