/**
 * Canonical engine types shared by core, providers, tools, and the TUI.
 * These are wire-format-agnostic; each provider adapter converts to/from its own shape.
 */

export type Effort = "low" | "medium" | "high" | "xhigh" | "max"
export const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"] as const

/**
 * The effort levels a model meaningfully supports, given its provider protocol. OpenAI's
 * `reasoning_effort` only accepts low/medium/high (xhigh/max collapse to high), while Anthropic and
 * Google take a thinking-token budget and honor all five. A non-reasoning model supports none.
 */
export function allowedEfforts(protocol?: "openai" | "anthropic" | "google", reasoning = true): readonly Effort[] {
  if (!reasoning) return []
  if (protocol === "openai") return ["low", "medium", "high"]
  return EFFORTS
}

/** A pending or completed tool call as the model expressed it. */
export interface ToolCall {
  id: string
  name: string
  /** raw JSON string of arguments (may be partial while streaming) */
  arguments: string
}

/** An image attached to a user message (base64-encoded). */
export interface ImagePart {
  data: string
  mime: string
}

/** Canonical conversation message kept by the engine. */
export type Message =
  | { role: "system"; text: string }
  | { role: "user"; text: string; images?: ImagePart[] }
  | { role: "assistant"; text?: string; reasoning?: string; reasoningSignature?: string; toolCalls?: ToolCall[] }
  | { role: "tool"; callId: string; name: string; result: string; isError?: boolean; images?: ImagePart[] }

/** Tool description handed to the model (JSON-Schema parameters). */
export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON Schema object
}

/** What a request to a provider needs. */
export interface ChatRequest {
  model: string
  messages: Message[]
  tools: ToolDef[]
  effort?: Effort
  maxTokens?: number
}

/** Provider wire protocol — selects the adapter. */
export type Protocol = "openai" | "anthropic" | "google"

/** A configured provider the user can connect to. */
export interface ProviderInfo {
  id: string
  name: string
  protocol: Protocol
  baseURL: string
  /** env vars to auto-detect a key from, if present */
  envKeys?: string[]
  /** true for OpenAI-compatible local servers (ollama/llama.cpp) that need no key */
  keyless?: boolean
  /** supports the OpenAI Responses API (/v1/responses) rather than just Chat Completions */
  supportsResponses?: boolean
  /** user added this as a custom endpoint */
  custom?: boolean
}

export interface ModelInfo {
  id: string
  name: string
  providerId: string
  contextWindow?: number
  maxOutput?: number
  /** model exposes a reasoning/thinking channel */
  reasoning?: boolean
  /** USD per 1M tokens, when known */
  cost?: { input: number; output: number }
  /** true when surfaced from the provider's own live endpoint (vs offline snapshot) */
  live?: boolean
}

/** Normalized streaming event emitted by every provider adapter. */
export type ProviderEvent =
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  /** the signed reasoning block (Anthropic) — must be replayed on later turns when tools are used */
  | { type: "reasoning_signature"; signature: string }
  | { type: "tool_start"; index: number; id: string; name: string }
  | { type: "tool_delta"; index: number; argsDelta: string }
  | { type: "tool_stop"; index: number }
  | { type: "usage"; input: number; output: number }
  | { type: "done"; stopReason: string }

/** Tool permission categories, matched against a mode's PermissionPolicy. */
export type PermissionCategory = "read" | "edit" | "bash" | "network" | "browser" | "computer"

/** A single item in the agent's live task list (maintained via the todo_write tool). */
export type TodoStatus = "pending" | "active" | "done"
export interface TodoItem {
  id: string
  text: string
  status: TodoStatus
}
