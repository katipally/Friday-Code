import { test, expect } from "bun:test"
import path from "node:path"
import { LspConnection } from "../src/protocol.ts"
import { LspManager, formatDiagnostics, pathToUri } from "../src/manager.ts"
import { languageForFile } from "../src/servers.ts"

const MOCK = path.join(import.meta.dir, "fixtures", "mock-lsp.ts")

test("LSP client framing: initialize, diagnostics notification, and requests round-trip", async () => {
  const conn = new LspConnection(["bun", MOCK], import.meta.dir)
  await conn.start()

  const init = await conn.request("initialize", { capabilities: {} })
  expect(init.capabilities).toBeDefined()
  conn.notify("initialized", {})

  const uri = "file:///proj/a.ts"
  conn.notify("textDocument/didOpen", { textDocument: { uri, languageId: "typescript", version: 1, text: "const x: number = 'no'" } })
  const diags = await conn.waitForDiagnostics(uri, 1500)
  expect(diags.length).toBe(1)
  expect(diags[0]!.severity).toBe(1)
  expect(diags[0]!.message).toContain("not assignable")

  const syms = await conn.request("workspace/symbol", { query: "Widget" })
  expect(syms[0].name).toBe("Widget")

  const hover = await conn.request("textDocument/hover", { textDocument: { uri }, position: { line: 0, character: 6 } })
  expect(hover.contents.value).toContain("number")

  conn.close()
})

test("manager degrades gracefully when no server matches the file", async () => {
  const mgr = new LspManager("/tmp")
  expect(languageForFile("notes.txt")).toBeUndefined()
  expect(await mgr.diagnose("/tmp/notes.unknownext")).toEqual([])
  expect(await mgr.hover("/tmp/notes.unknownext", 0, 0)).toBeUndefined()
  mgr.dispose()
})

test("formatDiagnostics renders a readable summary", () => {
  const out = formatDiagnostics("/proj/src/app.ts", [
    { range: { start: { line: 4, character: 2 }, end: { line: 4, character: 8 } }, severity: 1, message: "boom" },
  ])
  expect(out).toContain("app.ts")
  expect(out).toContain("1 error")
  expect(out).toContain("[5:3]")
})

test("pathToUri produces a file URI", () => {
  expect(pathToUri("/a/b/c.ts")).toBe("file:///a/b/c.ts")
})
