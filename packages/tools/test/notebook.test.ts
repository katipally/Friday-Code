import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { notebookEditTool } from "../src/builtin/notebook.ts"

function ctx(dir: string) {
  return { cwd: dir, roots: [dir], signal: new AbortController().signal }
}
function nbFile(dir: string) {
  const p = path.join(dir, "nb.ipynb")
  fs.writeFileSync(
    p,
    JSON.stringify({
      cells: [{ cell_type: "code", source: ["print(1)"], metadata: {}, outputs: [], execution_count: null }],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    }),
  )
  return p
}

test("edit replaces a cell's source and clears outputs", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nb-"))
  nbFile(dir)
  const res = await notebookEditTool.execute(
    { path: "nb.ipynb", action: "edit", cell: 0, source: "print(2)" },
    ctx(dir),
  )
  expect(res.isError).toBeFalsy()
  const nb = JSON.parse(fs.readFileSync(path.join(dir, "nb.ipynb"), "utf8"))
  expect(nb.cells[0].source.join("")).toBe("print(2)")
})

test("insert adds a markdown cell; delete removes a cell", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nb-"))
  nbFile(dir)
  await notebookEditTool.execute(
    { path: "nb.ipynb", action: "insert", cell: 0, cell_type: "markdown", source: "# Title" },
    ctx(dir),
  )
  let nb = JSON.parse(fs.readFileSync(path.join(dir, "nb.ipynb"), "utf8"))
  expect(nb.cells).toHaveLength(2)
  expect(nb.cells[0].cell_type).toBe("markdown")
  await notebookEditTool.execute({ path: "nb.ipynb", action: "delete", cell: 0 }, ctx(dir))
  nb = JSON.parse(fs.readFileSync(path.join(dir, "nb.ipynb"), "utf8"))
  expect(nb.cells).toHaveLength(1)
})
