#!/usr/bin/env bun
/** A tiny mock language server speaking LSP (Content-Length framed JSON-RPC) for tests. */
let buffer = Buffer.alloc(0)

function send(obj: unknown): void {
  const json = JSON.stringify(obj)
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`)
}

function handle(msg: any): void {
  if (msg.method === "initialize") {
    send({ jsonrpc: "2.0", id: msg.id, result: { capabilities: { hoverProvider: true } } })
    return
  }
  if (msg.method === "textDocument/didOpen") {
    const uri = msg.params.textDocument.uri
    send({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: {
        uri,
        diagnostics: [
          {
            range: { start: { line: 2, character: 4 }, end: { line: 2, character: 9 } },
            severity: 1,
            message: "Type error: not assignable",
          },
        ],
      },
    })
    return
  }
  if (msg.method === "textDocument/didChange") {
    const uri = msg.params.textDocument.uri
    send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri, diagnostics: [] } })
    return
  }
  if (msg.method === "workspace/symbol") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: [
        {
          name: "Widget",
          kind: 5,
          location: { uri: "file:///proj/widget.ts", range: { start: { line: 9, character: 0 } } },
        },
      ],
    })
    return
  }
  if (msg.method === "textDocument/hover") {
    send({ jsonrpc: "2.0", id: msg.id, result: { contents: { kind: "plaintext", value: "const x: number" } } })
    return
  }
  if (msg.id != null) send({ jsonrpc: "2.0", id: msg.id, result: null })
}

function drain(): void {
  while (true) {
    const i = buffer.indexOf("\r\n\r\n")
    if (i < 0) return
    const header = buffer.subarray(0, i).toString("utf8")
    const m = /Content-Length:\s*(\d+)/i.exec(header)
    if (!m) {
      buffer = buffer.subarray(i + 4)
      continue
    }
    const len = Number(m[1])
    const start = i + 4
    if (buffer.length < start + len) return
    const body = buffer.subarray(start, start + len).toString("utf8")
    buffer = buffer.subarray(start + len)
    try {
      handle(JSON.parse(body))
    } catch {
      /* ignore */
    }
  }
}

process.stdin.on("data", (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk])
  drain()
})
