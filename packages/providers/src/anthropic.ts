import type { ChatRequest, Message, ProviderEvent, ToolDef } from "@friday/shared"
import { safeJsonParse, sseLines } from "./sse.ts"
import { thinkingBudget } from "./effort.ts"

function toAnthropic(messages: Message[]): { system?: string; messages: unknown[] } {
  let system: string | undefined
  const out: Record<string, unknown>[] = []
  for (const m of messages) {
    if (m.role === "system") {
      system = system ? `${system}\n\n${m.text}` : m.text
    } else if (m.role === "user") {
      out.push({ role: "user", content: [{ type: "text", text: m.text }] })
    } else if (m.role === "assistant") {
      const content: Record<string, unknown>[] = []
      // Replay the signed thinking block first (required by Anthropic when thinking + tools are used).
      if (m.reasoning && m.reasoningSignature) {
        content.push({ type: "thinking", thinking: m.reasoning, signature: m.reasoningSignature })
      }
      if (m.text) content.push({ type: "text", text: m.text })
      for (const tc of m.toolCalls ?? []) {
        content.push({ type: "tool_use", id: tc.id, name: tc.name, input: safeJsonParse(tc.arguments || "{}") })
      }
      out.push({ role: "assistant", content: content.length ? content : [{ type: "text", text: "" }] })
    } else if (m.role === "tool") {
      out.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: m.callId, content: m.result, is_error: m.isError ?? false }],
      })
    }
  }
  return { system, messages: out }
}

function toTools(tools: ToolDef[]): unknown[] {
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }))
}

export async function* streamAnthropic(opts: {
  baseURL: string
  apiKey?: string
  req: ChatRequest
  signal: AbortSignal
  headers?: Record<string, string>
}): AsyncGenerator<ProviderEvent> {
  const { baseURL, apiKey, req, signal } = opts
  const { system, messages } = toAnthropic(req.messages)
  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens ?? 8192,
    messages,
    stream: true,
  }
  if (system) body.system = system
  if (req.tools.length) body.tools = toTools(req.tools)
  // Extended thinking: enable when a reasoning effort is requested. max_tokens must exceed the budget.
  if (req.effort) {
    const budget = thinkingBudget(req.effort)
    body.thinking = { type: "enabled", budget_tokens: budget }
    body.max_tokens = Math.min(budget + (req.maxTokens ?? 8192), 32000) // must exceed the budget, capped for safety
  }

  const res = await fetch(`${baseURL.replace(/\/$/, "")}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      ...(apiKey ? { "x-api-key": apiKey } : {}),
      ...opts.headers,
    },
    body: JSON.stringify(body),
    signal,
  })

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "")
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 400) || res.statusText}`)
  }

  for await (const line of sseLines(res.body)) {
    if (!line.startsWith("data:")) continue
    let json: any
    try {
      json = JSON.parse(line.slice(5).trim())
    } catch {
      continue
    }
    switch (json.type) {
      case "message_start":
        if (json.message?.usage?.input_tokens) {
          yield { type: "usage", input: json.message.usage.input_tokens, output: 0 }
        }
        break
      case "content_block_start": {
        const block = json.content_block
        if (block?.type === "tool_use") {
          yield { type: "tool_start", index: json.index, id: block.id, name: block.name }
        }
        break
      }
      case "content_block_delta": {
        const d = json.delta
        if (d?.type === "text_delta") yield { type: "text", delta: d.text }
        else if (d?.type === "thinking_delta") yield { type: "reasoning", delta: d.thinking }
        else if (d?.type === "signature_delta") yield { type: "reasoning_signature", signature: d.signature }
        else if (d?.type === "input_json_delta") yield { type: "tool_delta", index: json.index, argsDelta: d.partial_json }
        break
      }
      case "content_block_stop":
        yield { type: "tool_stop", index: json.index }
        break
      case "message_delta":
        if (json.usage?.output_tokens) yield { type: "usage", input: 0, output: json.usage.output_tokens }
        if (json.delta?.stop_reason) yield { type: "done", stopReason: json.delta.stop_reason }
        break
      case "message_stop":
        yield { type: "done", stopReason: "stop" }
        return
    }
  }
  yield { type: "done", stopReason: "stop" }
}
