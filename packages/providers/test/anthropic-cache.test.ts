import { test, expect, afterEach } from "bun:test"
import type { ChatRequest } from "@friday/shared"
import { streamAnthropic } from "../src/anthropic.ts"

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

// Minimal SSE body so the stream consumer completes cleanly.
function sseBody(): Response {
  const body = 'data: {"type":"message_stop"}\n\n'
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } })
}

async function drain(gen: AsyncGenerator<unknown>) {
  for await (const _ of gen) { /* consume */ }
}

test("places a rolling cache breakpoint on the last message block (plus system + last tool)", async () => {
  let captured: any
  globalThis.fetch = (async (_url: string, init: any) => {
    captured = JSON.parse(init.body)
    return sseBody()
  }) as typeof fetch

  const req: ChatRequest = {
    model: "claude-x",
    messages: [
      { role: "system", text: "you are friday" },
      { role: "user", text: "hello" },
      { role: "assistant", text: "hi" },
      { role: "user", text: "do the thing" },
    ],
    tools: [
      { name: "read", description: "read a file", parameters: { type: "object", properties: {} } },
      { name: "bash", description: "run a command", parameters: { type: "object", properties: {} } },
    ],
  }

  await drain(streamAnthropic({ baseURL: "https://api", apiKey: "k", req, signal: new AbortController().signal }))

  // System block is cached.
  expect(captured.system[0].cache_control).toEqual({ type: "ephemeral" })
  // Only the LAST tool def carries the breakpoint (caches the whole tool prefix).
  expect(captured.tools[0].cache_control).toBeUndefined()
  expect(captured.tools[1].cache_control).toEqual({ type: "ephemeral" })
  // The last content block of the last message carries the rolling conversation breakpoint.
  const lastMsg = captured.messages[captured.messages.length - 1]
  const lastBlock = lastMsg.content[lastMsg.content.length - 1]
  expect(lastBlock.cache_control).toEqual({ type: "ephemeral" })
  // Earlier messages are NOT individually marked (prefix is implied by the breakpoint above).
  expect(captured.messages[0].content[0].cache_control).toBeUndefined()
})
