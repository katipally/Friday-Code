import type { Message } from "@friday/shared"

/** Rough token estimate (~4 chars/token) across a message list. */
export function estimateTokens(messages: Message[]): number {
  let chars = 0
  for (const m of messages) {
    if ((m.role === "system" || m.role === "user") && m.text) chars += m.text.length
    if (m.role === "assistant") {
      if (m.text) chars += m.text.length
      if (m.reasoning) chars += m.reasoning.length
      for (const tc of m.toolCalls ?? []) chars += tc.name.length + tc.arguments.length
    }
    if (m.role === "tool") chars += m.result.length
  }
  return Math.ceil(chars / 4)
}

/**
 * Find a safe cut index at or before `target`: the start of a user turn, so we
 * never split an assistant tool_call from its tool results (which providers reject).
 * Returns 0 if no safe boundary exists past `floor`.
 */
export function safeCutIndex(messages: Message[], target: number, floor = 0): number {
  for (let i = Math.min(target, messages.length - 1); i > floor; i--) {
    if (messages[i]!.role === "user") return i
  }
  return 0
}

/** Render a slice of history into a compact transcript for the summarizer. */
export function renderTranscript(messages: Message[]): string {
  const out: string[] = []
  for (const m of messages) {
    if (m.role === "user") out.push(`USER: ${m.text}`)
    else if (m.role === "system") out.push(`SYSTEM: ${m.text}`)
    else if (m.role === "assistant") {
      if (m.text) out.push(`ASSISTANT: ${m.text}`)
      for (const tc of m.toolCalls ?? []) out.push(`ASSISTANT called ${tc.name}(${tc.arguments.slice(0, 200)})`)
    } else if (m.role === "tool") {
      out.push(`TOOL ${m.name} → ${m.result.slice(0, 400)}`)
    }
  }
  return out.join("\n")
}

export const COMPACTION = {
  /** Compact when the request would exceed this fraction of the model window. */
  threshold: 0.8,
  /** How many recent messages to always keep verbatim. */
  keepRecent: 8,
  /** Fallback context window when the model's is unknown. */
  defaultWindow: 128_000,
}
