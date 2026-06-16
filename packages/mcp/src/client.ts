import type { Transport } from "./transport.ts"

export interface McpToolSpec {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

/** A thin MCP client: initialize handshake + tools/list + tools/call. */
export class MCPClient {
  constructor(private transport: Transport) {}

  async connect(): Promise<void> {
    await this.transport.start()
    await this.transport.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "friday-code", version: "0.1.0" },
    })
    this.transport.notify("notifications/initialized", {})
  }

  async listTools(): Promise<McpToolSpec[]> {
    const r = await this.transport.request("tools/list", {})
    return (r?.tools ?? []) as McpToolSpec[]
  }

  async callTool(name: string, args: unknown): Promise<{ text: string; isError: boolean }> {
    const r = await this.transport.request("tools/call", { name, arguments: args ?? {} })
    const content: any[] = r?.content ?? []
    const text = content
      .filter((c) => c?.type === "text")
      .map((c) => c.text)
      .join("\n")
    return { text: text || (content.length ? JSON.stringify(content) : "(no output)"), isError: !!r?.isError }
  }

  close(): void {
    this.transport.close()
  }
}
