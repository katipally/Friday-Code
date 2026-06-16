import { test, expect, afterEach } from "bun:test"
import type { ProviderEvent } from "@friday/shared"
import { streamOpenAI } from "../src/openai.ts"
import { streamOpenAIResponses } from "../src/openai-responses.ts"
import { streamAnthropic } from "../src/anthropic.ts"
import { streamGoogle } from "../src/google.ts"

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

function stubFetch(body: string) {
  globalThis.fetch = (async () => new Response(body, { status: 200 })) as any
}

async function drain(gen: AsyncGenerator<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = []
  for await (const e of gen) out.push(e)
  return out
}

const req = { model: "m", messages: [{ role: "user" as const, text: "hi" }], tools: [] }

test("openai SSE normalization: text + tool call + usage", async () => {
  stubFetch(
    [
      `data: {"choices":[{"delta":{"content":"Hel"}}]}`,
      `data: {"choices":[{"delta":{"content":"lo"}}]}`,
      `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read","arguments":"{\\"path\\""}}]}}]}`,
      `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\\"a.txt\\"}"}}]}}]}`,
      `data: {"usage":{"prompt_tokens":5,"completion_tokens":3}}`,
      `data: [DONE]`,
    ].join("\n\n"),
  )
  const events = await drain(streamOpenAI({ baseURL: "https://x", req, signal: new AbortController().signal }))
  const text = events.filter((e) => e.type === "text").map((e: any) => e.delta).join("")
  expect(text).toBe("Hello")
  const start = events.find((e) => e.type === "tool_start") as any
  expect(start.name).toBe("read")
  const args = events.filter((e) => e.type === "tool_delta").map((e: any) => e.argsDelta).join("")
  expect(args).toBe('{"path":"a.txt"}')
  const usage = events.find((e) => e.type === "usage") as any
  expect(usage.input).toBe(5)
  expect(events.some((e) => e.type === "done")).toBe(true)
})

test("openai Responses SSE normalization: text + reasoning + function call + usage", async () => {
  stubFetch(
    [
      `data: {"type":"response.output_text.delta","delta":"Hel"}`,
      `data: {"type":"response.output_text.delta","delta":"lo"}`,
      `data: {"type":"response.reasoning_summary_text.delta","delta":"thinking…"}`,
      `data: {"type":"response.output_item.added","item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"read"}}`,
      `data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","delta":"{\\"path\\":\\"a\\"}"}`,
      `data: {"type":"response.function_call_arguments.done","item_id":"fc_1","arguments":"{\\"path\\":\\"a\\"}"}`,
      `data: {"type":"response.completed","response":{"usage":{"input_tokens":5,"output_tokens":3}}}`,
    ].join("\n\n"),
  )
  const events = await drain(streamOpenAIResponses({ baseURL: "https://x", req, signal: new AbortController().signal }))
  expect(events.filter((e) => e.type === "text").map((e: any) => e.delta).join("")).toBe("Hello")
  expect(events.filter((e) => e.type === "reasoning").map((e: any) => e.delta).join("")).toBe("thinking…")
  const start = events.find((e) => e.type === "tool_start") as any
  expect(start.name).toBe("read")
  expect(start.id).toBe("call_1")
  expect(events.filter((e) => e.type === "tool_delta").map((e: any) => e.argsDelta).join("")).toBe('{"path":"a"}')
  expect(events.some((e) => e.type === "usage")).toBe(true)
  expect(events.some((e) => e.type === "done")).toBe(true)
})

test("anthropic SSE normalization: text + tool_use + usage", async () => {
  stubFetch(
    [
      `event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":7}}}`,
      `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}`,
      `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}`,
      `event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tu_1","name":"read"}}`,
      `event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"a\\"}"}}`,
      `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":4}}`,
      `event: message_stop\ndata: {"type":"message_stop"}`,
    ].join("\n\n"),
  )
  const events = await drain(streamAnthropic({ baseURL: "https://x", req, signal: new AbortController().signal }))
  const text = events.filter((e) => e.type === "text").map((e: any) => e.delta).join("")
  expect(text).toBe("Hi")
  const start = events.find((e) => e.type === "tool_start") as any
  expect(start.name).toBe("read")
  expect(start.id).toBe("tu_1")
  const args = events.filter((e) => e.type === "tool_delta").map((e: any) => e.argsDelta).join("")
  expect(args).toBe('{"path":"a"}')
  expect(events.some((e) => e.type === "usage")).toBe(true)
  expect(events.some((e) => e.type === "done")).toBe(true)
})

test("anthropic enables extended thinking when an effort is set", async () => {
  let body: any
  globalThis.fetch = (async (_url: string, init: any) => {
    body = JSON.parse(init.body)
    return new Response(`data: {"type":"message_stop"}`, { status: 200 })
  }) as any
  await drain(streamAnthropic({ baseURL: "https://x", req: { ...req, effort: "high" }, signal: new AbortController().signal }))
  expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 8192 })
  expect(body.max_tokens).toBeGreaterThan(8192)
})

test("anthropic emits reasoning + signature from a thinking block, and replays the signed block", async () => {
  // emit
  stubFetch(
    [
      `data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}`,
      `data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"pondering"}}`,
      `data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig-abc"}}`,
      `data: {"type":"message_stop"}`,
    ].join("\n\n"),
  )
  const events = await drain(streamAnthropic({ baseURL: "https://x", req, signal: new AbortController().signal }))
  expect(events.filter((e) => e.type === "reasoning").map((e: any) => e.delta).join("")).toBe("pondering")
  expect((events.find((e) => e.type === "reasoning_signature") as any).signature).toBe("sig-abc")

  // replay
  let body: any
  globalThis.fetch = (async (_url: string, init: any) => {
    body = JSON.parse(init.body)
    return new Response(`data: {"type":"message_stop"}`, { status: 200 })
  }) as any
  const replayReq = {
    model: "m",
    tools: [],
    messages: [
      { role: "user" as const, text: "hi" },
      {
        role: "assistant" as const,
        reasoning: "hmm",
        reasoningSignature: "sig-xyz",
        toolCalls: [{ id: "t1", name: "read", arguments: "{}" }],
      },
      { role: "tool" as const, callId: "t1", name: "read", result: "ok" },
    ],
  }
  await drain(streamAnthropic({ baseURL: "https://x", req: replayReq, signal: new AbortController().signal }))
  const assistant = body.messages.find((m: any) => m.role === "assistant")
  expect(assistant.content[0]).toEqual({ type: "thinking", thinking: "hmm", signature: "sig-xyz" })
})

test("google sends thinkingConfig and parses thought parts as reasoning", async () => {
  let body: any
  globalThis.fetch = (async (_url: string, init: any) => {
    body = JSON.parse(init.body)
    return new Response(
      `data: {"candidates":[{"content":{"parts":[{"text":"pondering","thought":true},{"text":"Answer"}]}}]}`,
      { status: 200 },
    )
  }) as any
  const events = await drain(
    streamGoogle({ baseURL: "https://x", req: { ...req, effort: "medium" }, signal: new AbortController().signal }),
  )
  expect(body.generationConfig.thinkingConfig.includeThoughts).toBe(true)
  expect(events.filter((e) => e.type === "reasoning").map((e: any) => e.delta).join("")).toBe("pondering")
  expect(events.filter((e) => e.type === "text").map((e: any) => e.delta).join("")).toBe("Answer")
})

test("google SSE normalization: text + functionCall + usage", async () => {
  stubFetch(
    [
      `data: {"candidates":[{"content":{"parts":[{"text":"Hi"}]}}]}`,
      `data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"read","args":{"path":"a"}}}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":2}}`,
    ].join("\n\n"),
  )
  const events = await drain(streamGoogle({ baseURL: "https://x", req, signal: new AbortController().signal }))
  const text = events.filter((e) => e.type === "text").map((e: any) => e.delta).join("")
  expect(text).toBe("Hi")
  const start = events.find((e) => e.type === "tool_start") as any
  expect(start.name).toBe("read")
  const args = events.filter((e) => e.type === "tool_delta").map((e: any) => e.argsDelta).join("")
  expect(args).toBe('{"path":"a"}')
  expect(events.some((e) => e.type === "usage")).toBe(true)
  expect(events.some((e) => e.type === "done")).toBe(true)
})
