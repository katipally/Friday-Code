/**
 * The engine <-> UI contract. The headless engine emits `EngineEvent`s; the UI sends `UICommand`s.
 * Fully fleshed out across M1+; declared here so both sides share one source of truth from day one.
 */
import type { ModeId } from "./modes.ts"
import type { MascotState } from "./mascot.ts"
import type { Message, TodoItem } from "./types.ts"

/**
 * The event payloads. Every event is additionally tagged with the `sessionId` it
 * belongs to (see `EngineEvent`) so the UI can route foreground vs background
 * sessions when several run concurrently.
 */
export type EngineEventBody =
  | { type: "ready"; needsModel: boolean }
  | { type: "model-changed"; model: string; provider: string; reasoning: boolean }
  | { type: "message-start"; role: "assistant"; id: string }
  | { type: "text"; id: string; delta: string }
  | { type: "reasoning"; id: string; delta: string }
  | { type: "tool-call"; id: string; callId: string; name: string; input: unknown }
  | { type: "tool-result"; callId: string; ok: boolean; output: string; title?: string; diff?: string }
  | { type: "permission-request"; requestId: string; tool: string; summary: string; detail?: string }
  | { type: "ask-user"; requestId: string; question: string; options?: string[] }
  | { type: "turn-done"; id: string }
  | { type: "usage"; input: number; output: number; costUsd?: number }
  | { type: "mascot"; state: MascotState }
  | { type: "status"; text: string; elapsedMs?: number; tokens?: number }
  | { type: "session-changed"; sessionId: string; title: string; cwd: string; roots: string[] }
  | { type: "session-loaded"; sessionId: string; title: string; cwd: string; roots: string[]; messages: Message[] }
  | { type: "todos"; items: TodoItem[] }
  | { type: "compaction"; turnsCompacted: number; kept: number; tokensBefore: number; tokensAfter: number }
  | { type: "error"; message: string }

/** A bus event, tagged with the session it originates from. */
export type EngineEvent = EngineEventBody & { sessionId: string }

export type UICommand =
  | { type: "prompt"; text: string }
  | { type: "abort" }
  | { type: "set-mode"; mode: ModeId }
  | { type: "set-model"; model: string }
  | { type: "set-effort"; effort: string }
  | { type: "permission-reply"; requestId: string; decision: "allow-once" | "allow-always" | "deny" }
  | { type: "ask-reply"; requestId: string; answer: string }
  | { type: "switch-session"; sessionId: string }
  | { type: "new-session" }
  | { type: "run-command"; command: string }
