/**
 * The engine <-> UI contract. The headless engine emits `EngineEvent`s; the UI sends `UICommand`s.
 * Fully fleshed out across M1+; declared here so both sides share one source of truth from day one.
 */

import type { MascotState } from "./mascot.ts"
import type { ModeId } from "./modes.ts"
import type { ImagePart, Message, TodoItem } from "./types.ts"

/**
 * The event payloads. Every event is additionally tagged with the `sessionId` it
 * belongs to (see `EngineEvent`) so the UI can route foreground vs background
 * sessions when several run concurrently.
 */
export type EngineEventBody =
  | { type: "ready"; needsModel: boolean }
  | { type: "model-changed"; model: string; provider: string; reasoning: boolean; contextWindow?: number }
  | { type: "message-start"; role: "assistant"; id: string; mode: ModeId }
  | { type: "text"; id: string; delta: string }
  | { type: "reasoning"; id: string; delta: string }
  | { type: "tool-call"; id: string; callId: string; name: string; input: unknown }
  | { type: "tool-result"; callId: string; ok: boolean; output: string; title?: string; diff?: string }
  | { type: "permission-request"; requestId: string; tool: string; summary: string; detail?: string; risk?: string }
  | { type: "ask-user"; requestId: string; questions: AskQuestion[] }
  | { type: "turn-done"; id: string }
  /** Finalize an intermediate assistant bubble (one that ended in tool calls) mid-turn: stops its
   * streaming caret without ending the turn (busy stays true; usage stays on the final bubble). */
  | { type: "message-stop"; id: string; intermediate: boolean; interrupted?: boolean }
  /** A plan-mode turn finished with a proposed plan; the UI offers an execute/keep-planning gate. */
  | { type: "plan-ready"; plan: string }
  | { type: "usage"; input: number; output: number; costUsd?: number }
  | { type: "mascot"; state: MascotState }
  | { type: "status"; text: string; elapsedMs?: number; tokens?: number }
  | { type: "session-changed"; sessionId: string; title: string; cwd: string; roots: string[] }
  | { type: "session-loaded"; sessionId: string; title: string; cwd: string; roots: string[]; messages: Message[] }
  | { type: "todos"; items: TodoItem[] }
  /** The session's persisted plan list (emitted on resume so the Context panel rebuilds it). */
  | { type: "plans"; items: { id: string; title: string; text: string }[] }
  | { type: "diagnostics"; items: { path: string; errors: number; warnings: number }[] }
  | {
      type: "changed-files"
      items: { path: string; status: string; added: number; removed: number }[]
      branch?: string
    }
  | {
      type: "session-files"
      items: { path: string; status: string; added: number; removed: number; kind?: "file" | "dir" }[]
    }
  /** Compaction is starting — drives the progress modal (sonar pulse + real before-% bar). */
  | { type: "compaction-start"; tokensBefore: number; pctBefore: number; window: number }
  /** Compaction finished. `summary` is the generated summary text (for the read-only viewer);
   * pctAfter is the real context-usage % after the cut. */
  | {
      type: "compaction"
      turnsCompacted: number
      kept: number
      tokensBefore: number
      tokensAfter: number
      summary: string
      pctAfter: number
    }
  /** Compaction was stopped (user) or could not proceed — clears the progress modal. */
  | { type: "compaction-aborted" }
  | { type: "notice"; text: string }
  /** Background tasks (agent-spawned async sessions + due cron runs) — drives the sidebar Tasks panel. */
  | {
      type: "tasks"
      items: { id: string; title: string; description: string; status: "running" | "done"; summary?: string }[]
    }
  /** Agent-team shared board — drives the console/dashboard view. Null when no team is active. */
  | {
      type: "team"
      team: {
        teamId: string
        goal: string
        status: string
        members: { sessionId: string; role: string; status: string; activity: string }[]
        posts: {
          id: number
          sessionId: string
          role: string
          kind: string
          toRole?: string
          text: string
          createdAt: number
        }[]
        claims: { path: string; sessionId: string }[]
      } | null
    }
  | { type: "error"; message: string }
  // A /add note (id correlates with the optimistic UI item) has been folded into the agent's context
  // at a step boundary — the UI flips its "pending" chip to "attached".
  | { type: "inject-attached"; id: string }

/**
 * One selectable choice in an ask_user question — a short label, an optional explanation, and an
 * optional `preview`: a multi-line ASCII diagram / mockup / code snippet shown beside the options so
 * the user can compare choices visually (e.g. layout sketches or config examples).
 */
export type AskOption = { label: string; description?: string; preview?: string }

/** One question in an ask_user request. The agent may pose several at once. */
export type AskQuestion = {
  id: string
  question: string
  /** very short tab/section label (e.g. "Auth method") — shown when several questions are posed. */
  header?: string
  /** optional small ASCII banner/diagram for the whole question, rendered above the question text. */
  art?: string
  options?: AskOption[]
  multi?: boolean
}

/** A bus event, tagged with the session it originates from. */
export type EngineEvent = EngineEventBody & { sessionId: string }

export type UICommand =
  | { type: "prompt"; text: string }
  | { type: "abort" }
  // Steer a running agent without stopping it: `inject` folds a user note in at the next loop
  // step; `inject-pause` makes the agent idle at the next step boundary while the user composes;
  // `inject-resume` releases that pause (used by the modal's cancel path).
  | { type: "inject"; id?: string; text: string; images?: ImagePart[]; interrupt?: boolean }
  | { type: "inject-pause"; interrupt?: boolean }
  | { type: "inject-resume" }
  | { type: "set-mode"; mode: ModeId }
  | { type: "set-model"; model: string }
  | { type: "set-effort"; effort: string }
  | { type: "permission-reply"; requestId: string; decision: "allow-once" | "allow-always" | "deny" }
  | { type: "ask-reply"; requestId: string; answers: Record<string, string> }
  | { type: "switch-session"; sessionId: string }
  | { type: "new-session" }
  | { type: "run-command"; command: string }
  | { type: "stop-compaction" }
  | { type: "undo-compaction" }
  | { type: "open-path"; path: string }
