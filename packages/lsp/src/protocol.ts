/**
 * Minimal Language Server Protocol client over stdio.
 * LSP frames messages with `Content-Length: <n>\r\n\r\n<json>` (not newline-delimited).
 */
export interface Position {
  line: number
  character: number
}
export interface Range {
  start: Position
  end: Position
}
export interface Diagnostic {
  range: Range
  severity?: 1 | 2 | 3 | 4 // 1 error, 2 warning, 3 info, 4 hint
  message: string
  source?: string
}

const REQUEST_TIMEOUT = 15_000

export class LspConnection {
  private proc?: ReturnType<typeof Bun.spawn>
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>()
  private id = 0
  private buffer = Buffer.alloc(0)
  /** latest diagnostics per document uri */
  readonly diagnostics = new Map<string, Diagnostic[]>()
  /** one-shot waiters for the next publishDiagnostics of a uri */
  private diagWaiters = new Map<string, Array<(d: Diagnostic[]) => void>>()
  private alive = false

  constructor(private command: string[], private cwd: string) {}

  async start(): Promise<void> {
    const [cmd, ...args] = this.command
    this.proc = Bun.spawn([cmd!, ...args], { cwd: this.cwd, stdin: "pipe", stdout: "pipe", stderr: "ignore" })
    this.alive = true
    void this.readLoop()
  }

  get isAlive(): boolean {
    return this.alive
  }

  private async readLoop(): Promise<void> {
    const reader = (this.proc!.stdout as ReadableStream<Uint8Array>).getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      this.buffer = Buffer.concat([this.buffer, Buffer.from(value)])
      this.drain()
    }
    this.alive = false
  }

  private drain(): void {
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n")
      if (headerEnd < 0) return
      const header = this.buffer.subarray(0, headerEnd).toString("utf8")
      const m = /Content-Length:\s*(\d+)/i.exec(header)
      if (!m) {
        this.buffer = this.buffer.subarray(headerEnd + 4)
        continue
      }
      const len = Number(m[1])
      const bodyStart = headerEnd + 4
      if (this.buffer.length < bodyStart + len) return // wait for more
      const body = this.buffer.subarray(bodyStart, bodyStart + len).toString("utf8")
      this.buffer = this.buffer.subarray(bodyStart + len)
      try {
        this.handle(JSON.parse(body))
      } catch {
        /* ignore malformed */
      }
    }
  }

  private handle(msg: any): void {
    // Response to one of our requests.
    if (msg.id != null && (msg.result !== undefined || msg.error !== undefined) && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!
      this.pending.delete(msg.id)
      if (msg.error) p.reject(new Error(msg.error.message ?? "LSP error"))
      else p.resolve(msg.result)
      return
    }
    // Server-initiated request — answer minimally so the server stays happy.
    if (msg.id != null && msg.method) {
      const result = msg.method === "workspace/configuration" ? (msg.params?.items ?? []).map(() => null) : null
      this.write({ jsonrpc: "2.0", id: msg.id, result })
      return
    }
    // Notification.
    if (msg.method === "textDocument/publishDiagnostics") {
      const uri = msg.params?.uri as string
      const diags = (msg.params?.diagnostics ?? []) as Diagnostic[]
      if (uri) {
        this.diagnostics.set(uri, diags)
        const waiters = this.diagWaiters.get(uri)
        if (waiters) {
          this.diagWaiters.delete(uri)
          for (const w of waiters) w(diags)
        }
      }
    }
  }

  private write(obj: unknown): void {
    const json = JSON.stringify(obj)
    const payload = `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`
    ;(this.proc?.stdin as { write?: (s: string) => void } | undefined)?.write?.(payload)
  }

  request(method: string, params?: unknown): Promise<any> {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.write({ jsonrpc: "2.0", id, method, params })
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`LSP request timed out: ${method}`))
      }, REQUEST_TIMEOUT)
    })
  }

  notify(method: string, params?: unknown): void {
    this.write({ jsonrpc: "2.0", method, params })
  }

  /** Resolve with the next publishDiagnostics for `uri`, or current cache after `timeoutMs`. */
  waitForDiagnostics(uri: string, timeoutMs = 1500): Promise<Diagnostic[]> {
    return new Promise((resolve) => {
      const arr = this.diagWaiters.get(uri) ?? []
      const done = (d: Diagnostic[]) => resolve(d)
      arr.push(done)
      this.diagWaiters.set(uri, arr)
      setTimeout(() => {
        const list = this.diagWaiters.get(uri)
        if (list) this.diagWaiters.set(uri, list.filter((w) => w !== done))
        resolve(this.diagnostics.get(uri) ?? [])
      }, timeoutMs)
    })
  }

  close(): void {
    this.alive = false
    try {
      this.proc?.kill()
    } catch {
      /* ignore */
    }
  }
}
