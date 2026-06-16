import { obj, type Tool } from "../tool.ts"

export const LSP_HOVER = "lsp_hover"
export const LSP_DEFINITION = "lsp_definition"
export const LSP_SYMBOLS = "lsp_symbols"
export const LSP_TOOLS = new Set([LSP_HOVER, LSP_DEFINITION, LSP_SYMBOLS])

/** All handled specially by the engine (they need the live LspManager); `execute` is never called. */

export const lspHoverTool: Tool = {
  name: LSP_HOVER,
  description:
    "Ask the language server for type info / docs at a position in a file (true compiler knowledge, not a guess). Line and character are 1-based.",
  permission: "read",
  parameters: obj(
    {
      path: { type: "string", description: "file path" },
      line: { type: "number", description: "1-based line" },
      character: { type: "number", description: "1-based column" },
    },
    ["path", "line", "character"],
  ),
  async execute() {
    return { output: "" }
  },
}

export const lspDefinitionTool: Tool = {
  name: LSP_DEFINITION,
  description: "Jump to the definition of the symbol at a position via the language server. Line and character are 1-based.",
  permission: "read",
  parameters: obj(
    {
      path: { type: "string", description: "file path" },
      line: { type: "number", description: "1-based line" },
      character: { type: "number", description: "1-based column" },
    },
    ["path", "line", "character"],
  ),
  async execute() {
    return { output: "" }
  },
}

export const lspSymbolsTool: Tool = {
  name: LSP_SYMBOLS,
  description:
    "List symbols via the language server: pass `query` to search the whole workspace by name, or `path` to list a file's symbols.",
  permission: "read",
  parameters: obj({
    query: { type: "string", description: "workspace symbol name to search for" },
    path: { type: "string", description: "file to list document symbols for" },
  }),
  async execute() {
    return { output: "" }
  },
}
