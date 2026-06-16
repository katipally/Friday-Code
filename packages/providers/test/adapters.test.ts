import { test, expect, afterEach } from "bun:test"
import type { ProviderEvent } from "@friday/shared"
import { streamOpenAI } from "../src/openai.ts"
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
