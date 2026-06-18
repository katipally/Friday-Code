import { expect, test } from "bun:test"
import { MCPClient } from "../src/client.ts"
import type { Transport } from "../src/transport.ts"

function fakeTransport(): Transport {
  return {
    async start() {},
    async request(method: string, params: any) {
      if (method === "initialize") return { protocolVersion: "2025-06-18" }
      if (method === "tools/list")
        return {
          tools: [
            {
              name: "echo",
              description: "echo text",
              inputSchema: { type: "object", properties: { text: { type: "string" } } },
            },
          ],
        }
      if (method === "tools/call")
        return { content: [{ type: "text", text: `called ${params.name}: ${JSON.stringify(params.arguments)}` }] }
      return {}
    },
    notify() {},
    close() {},
  }
}

test("MCPClient: connect, list tools, call tool", async () => {
  const client = new MCPClient(fakeTransport())
  await client.connect()
  const tools = await client.listTools()
  expect(tools[0]?.name).toBe("echo")
  const { text, isError } = await client.callTool("echo", { text: "hi" })
  expect(isError).toBe(false)
  expect(text).toContain('called echo: {"text":"hi"}')
})

test("MCPClient: tool error surfaces isError", async () => {
  const t: Transport = {
    async start() {},
    async request(method: string) {
      if (method === "tools/call") return { content: [{ type: "text", text: "boom" }], isError: true }
      return {}
    },
    notify() {},
    close() {},
  }
  const client = new MCPClient(t)
  const { isError } = await client.callTool("x", {})
  expect(isError).toBe(true)
})
