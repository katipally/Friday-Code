/** Minimal JSON-RPC 2.0 transport abstraction for MCP (stdio + streamable-http). */
export interface Transport {
  start(): Promise<void>
  request(method: string, params?: unknown): Promise<any>
  notify(method: string, params?: unknown): void
  close(): void
}

export interface StdioConfig {
  type: "stdio"
  command: string[]
  env?: Record<string, string>
  cwd?: string
}
export interface HttpConfig {
  type: "http"
  url: string
  headers?: Record<string, string>
}
export type McpServerConfig = StdioConfig | HttpConfig

const REQUEST_TIMEOUT = 30_000

/** stdio transport: newline-delimited JSON-RPC over a child process. */
export class StdioTransport implements Transport {
  private proc?: ReturnType<typeof Bun.spawn>
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>()
  private id = 0
  private buffer = ""

  constructor(private cfg: StdioConfig) {}

  async start(): Promise<void> {
    const [cmd, ...args] = this.cfg.command
    this.proc = Bun.spawn([cmd!, ...args], {
      cwd: this.cfg.cwd,
      env: { ...process.env, ...this.cfg.env },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
    })
    this.readLoop()
  }

  private async readLoop(): Promise<void> {
    const stream = this.proc!.stdout as ReadableStream<Uint8Array>
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      this.buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, nl).trim()
        this.buffer = this.buffer.slice(nl + 1)
        if (line) this.handle(line)
      }
    }
  }

  private handle(line: string): void {
    let msg: any
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    if (msg.id != null && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!
      this.pending.delete(msg.id)
      if (msg.error) p.reject(new Error(msg.error.message ?? "MCP error"))
      else p.resolve(msg.result)
    }
  }

  private write(obj: unknown): void {
    const data = `${JSON.stringify(obj)}\n`
    const stdin = this.proc?.stdin as { write?: (s: string) => void } | undefined
    stdin?.write?.(data)
  }

  request(method: string, params?: unknown): Promise<any> {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.write({ jsonrpc: "2.0", id, method, params })
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`MCP request timed out: ${method}`))
      }, REQUEST_TIMEOUT)
    })
  }

  notify(method: string, params?: unknown): void {
    this.write({ jsonrpc: "2.0", method, params })
  }

  close(): void {
    try {
      this.proc?.kill()
    } catch {
      /* ignore */
    }
  }
}

/** streamable-http transport: POST JSON-RPC; parse a JSON or SSE response. */
export class HttpTransport implements Transport {
  private id = 0
  constructor(private cfg: HttpConfig) {}

  async start(): Promise<void> {
    /* stateless */
  }

  async request(method: string, params?: unknown): Promise<any> {
    const id = ++this.id
    const res = await fetch(this.cfg.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...this.cfg.headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    })
    const ct = res.headers.get("content-type") ?? ""
    let json: any
    if (ct.includes("text/event-stream")) {
      const text = await res.text()
      const dataLines = text
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
      for (const d of dataLines) {
        try {
          const parsed = JSON.parse(d)
          if (parsed.id === id) json = parsed
        } catch {
          /* ignore */
        }
      }
    } else {
      json = await res.json()
    }
    if (!json) throw new Error(`empty MCP response for ${method}`)
    if (json.error) throw new Error(json.error.message ?? "MCP error")
    return json.result
  }

  notify(method: string, params?: unknown): void {
    void fetch(this.cfg.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...this.cfg.headers },
      body: JSON.stringify({ jsonrpc: "2.0", method, params }),
    }).catch(() => {})
  }

  close(): void {
    /* stateless */
  }
}

export function makeTransport(cfg: McpServerConfig): Transport {
  return cfg.type === "stdio" ? new StdioTransport(cfg) : new HttpTransport(cfg)
}
