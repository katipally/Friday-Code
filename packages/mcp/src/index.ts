import type { Tool } from "@friday/tools"
import { MCPClient } from "./client.ts"
import { type McpServerConfig, makeTransport } from "./transport.ts"

export { MCPClient, type McpToolSpec } from "./client.ts"
export * from "./transport.ts"

export interface McpConnection {
  tools: Tool[]
  servers: string[]
  close(): void
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60)
}

/** Connect to all configured MCP servers and return their tools wrapped for the registry. */
export async function connectServers(servers: Record<string, McpServerConfig>): Promise<McpConnection> {
  const clients: MCPClient[] = []
  const tools: Tool[] = []
  const connected: string[] = []

  for (const [serverName, cfg] of Object.entries(servers ?? {})) {
    try {
      const client = new MCPClient(makeTransport(cfg))
      await client.connect()
      const specs = await client.listTools()
      clients.push(client)
      connected.push(serverName)
      for (const spec of specs) {
        tools.push({
          name: sanitize(`${serverName}_${spec.name}`),
          description: `[mcp:${serverName}] ${spec.description ?? ""}`.trim(),
          parameters: spec.inputSchema ?? { type: "object", properties: {} },
          permission: "bash", // external side effects — gate like a shell command
          async execute(input) {
            try {
              const { text, isError } = await client.callTool(spec.name, input)
              return { output: text, isError, title: `${serverName}:${spec.name}` }
            } catch (e: any) {
              return { output: `MCP error: ${e?.message ?? e}`, isError: true, title: `${serverName}:${spec.name}` }
            }
          },
        })
      }
    } catch {
      // Skip a server that fails to connect; the rest still work.
    }
  }

  return {
    tools,
    servers: connected,
    close: () =>
      clients.forEach((c) => {
        c.close()
      }),
  }
}
