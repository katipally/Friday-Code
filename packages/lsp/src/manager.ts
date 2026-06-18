import fs from "node:fs"
import path from "node:path"
import { type Diagnostic, LspConnection } from "./protocol.ts"
import { languageForFile, resolveServer } from "./servers.ts"

export function pathToUri(p: string): string {
  return (
    "file://" +
    path
      .resolve(p)
      .split(path.sep)
      .map(encodeURIComponent)
      .join("/")
      .replace(/^([A-Za-z]:)/, "/$1")
  )
}
export function uriToPath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, ""))
}

interface Doc {
  version: number
}

/**
 * Spawns and drives language servers on demand, one per (root, language).
 * Every method degrades gracefully to null/empty when no server binary exists.
 */
export class LspManager {
  private clients = new Map<string, LspConnection>() // key: `${root}::${language}`
  private opened = new Map<string, Doc>() // key: file path
  private failed = new Set<string>() // languages we already know have no server

  constructor(private root: string) {}

  private async clientFor(file: string): Promise<LspConnection | undefined> {
    const language = languageForFile(file)
    if (!language || this.failed.has(language)) return undefined
    const key = `${this.root}::${language}`
    const existing = this.clients.get(key)
    if (existing) {
      if (existing.isAlive) return existing
      this.clients.delete(key)
      return undefined
    }

    const server = resolveServer(language)
    if (!server) {
      this.failed.add(language)
      return undefined
    }
    const conn = new LspConnection(server.command, this.root)
    try {
      await conn.start()
      await conn.request("initialize", {
        processId: process.pid,
        rootUri: pathToUri(this.root),
        workspaceFolders: [{ uri: pathToUri(this.root), name: path.basename(this.root) }],
        capabilities: {
          textDocument: {
            synchronization: { dynamicRegistration: false },
            publishDiagnostics: {},
            hover: { contentFormat: ["plaintext", "markdown"] },
            definition: {},
            documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          },
          workspace: { symbol: {}, workspaceFolders: true, configuration: true },
        },
      })
      conn.notify("initialized", {})
      this.clients.set(key, conn)
      return conn
    } catch {
      conn.close()
      this.failed.add(language)
      return undefined
    }
  }

  private async ensureOpen(conn: LspConnection, file: string): Promise<void> {
    if (this.opened.has(file)) return
    let text = ""
    try {
      text = fs.readFileSync(file, "utf8")
    } catch {
      return
    }
    const language = languageForFile(file) ?? "plaintext"
    conn.notify("textDocument/didOpen", {
      textDocument: { uri: pathToUri(file), languageId: language, version: 1, text },
    })
    this.opened.set(file, { version: 1 })
  }

  /** Push the current file contents and return fresh diagnostics for it. */
  async diagnose(file: string): Promise<Diagnostic[]> {
    const conn = await this.clientFor(file)
    if (!conn) return []
    await this.ensureOpen(conn, file)
    let text = ""
    try {
      text = fs.readFileSync(file, "utf8")
    } catch {
      return []
    }
    const doc = this.opened.get(file) ?? { version: 1 }
    doc.version += 1
    this.opened.set(file, doc)
    const uri = pathToUri(file)
    conn.notify("textDocument/didChange", {
      textDocument: { uri, version: doc.version },
      contentChanges: [{ text }],
    })
    return conn.waitForDiagnostics(uri, 1500)
  }

  async hover(file: string, line: number, character: number): Promise<string | undefined> {
    const conn = await this.clientFor(file)
    if (!conn) return undefined
    await this.ensureOpen(conn, file)
    const res = await conn
      .request("textDocument/hover", { textDocument: { uri: pathToUri(file) }, position: { line, character } })
      .catch(() => undefined)
    const c = res?.contents
    if (!c) return undefined
    if (typeof c === "string") return c
    if (Array.isArray(c)) return c.map((x) => (typeof x === "string" ? x : x.value)).join("\n")
    return c.value
  }

  async definition(file: string, line: number, character: number): Promise<string[]> {
    const conn = await this.clientFor(file)
    if (!conn) return []
    await this.ensureOpen(conn, file)
    const res = await conn
      .request("textDocument/definition", { textDocument: { uri: pathToUri(file) }, position: { line, character } })
      .catch(() => undefined)
    const arr = Array.isArray(res) ? res : res ? [res] : []
    return arr.map((loc: any) => {
      const uri = loc.uri ?? loc.targetUri
      const range = loc.range ?? loc.targetSelectionRange
      return `${uriToPath(uri)}:${(range?.start?.line ?? 0) + 1}`
    })
  }

  async documentSymbols(file: string): Promise<string[]> {
    const conn = await this.clientFor(file)
    if (!conn) return []
    await this.ensureOpen(conn, file)
    const res = await conn
      .request("textDocument/documentSymbol", { textDocument: { uri: pathToUri(file) } })
      .catch(() => [])
    const flat: string[] = []
    const walk = (items: any[]) => {
      for (const s of items ?? []) {
        const line = (s.range?.start?.line ?? s.location?.range?.start?.line ?? 0) + 1
        flat.push(`${s.name} (${symbolKind(s.kind)}) :${line}`)
        if (s.children) walk(s.children)
      }
    }
    walk(Array.isArray(res) ? res : [])
    return flat
  }

  /** Resolve a symbol name across the workspace → "name — path:line" hits. */
  async workspaceSymbols(query: string, anyFile = "x.ts"): Promise<{ name: string; path: string; line: number }[]> {
    const conn = await this.clientFor(anyFile)
    if (!conn) return []
    const res = await conn.request("workspace/symbol", { query }).catch(() => [])
    return (Array.isArray(res) ? res : []).slice(0, 20).map((s: any) => ({
      name: s.name,
      path: uriToPath(s.location?.uri ?? ""),
      line: (s.location?.range?.start?.line ?? 0) + 1,
    }))
  }

  dispose(): void {
    for (const c of this.clients.values()) c.close()
    this.clients.clear()
  }
}

function symbolKind(k: number): string {
  const kinds = [
    "",
    "file",
    "module",
    "namespace",
    "package",
    "class",
    "method",
    "property",
    "field",
    "constructor",
    "enum",
    "interface",
    "function",
    "variable",
    "constant",
    "string",
    "number",
    "boolean",
    "array",
    "object",
    "key",
    "null",
    "enum-member",
    "struct",
    "event",
    "operator",
    "type-param",
  ]
  return kinds[k] ?? "symbol"
}

/** One-line summary of diagnostics for injection into tool output. */
export function formatDiagnostics(file: string, diags: Diagnostic[]): string {
  if (!diags.length) return ""
  const sev = (s?: number) => (s === 1 ? "error" : s === 2 ? "warning" : s === 3 ? "info" : "hint")
  const lines = diags
    .slice(0, 20)
    .map(
      (d) =>
        `  ${sev(d.severity)} [${d.range.start.line + 1}:${d.range.start.character + 1}] ${d.message.split("\n")[0]}`,
    )
  const errs = diags.filter((d) => d.severity === 1).length
  const warns = diags.filter((d) => d.severity === 2).length
  return `\nLSP diagnostics for ${path.basename(file)} (${errs} error${errs === 1 ? "" : "s"}, ${warns} warning${warns === 1 ? "" : "s"}):\n${lines.join("\n")}`
}
