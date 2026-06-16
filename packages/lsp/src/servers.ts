/** Language-server registry: file extension → language id + launch command. */
export interface ServerDef {
  languageId: string
  /** candidate commands (first whose binary exists wins) */
  commands: string[][]
}

const EXT_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescriptreact",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascriptreact",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  go: "go",
  rs: "rust",
}

const SERVERS: Record<string, ServerDef> = {
  typescript: { languageId: "typescript", commands: [["typescript-language-server", "--stdio"]] },
  typescriptreact: { languageId: "typescriptreact", commands: [["typescript-language-server", "--stdio"]] },
  javascript: { languageId: "javascript", commands: [["typescript-language-server", "--stdio"]] },
  javascriptreact: { languageId: "javascriptreact", commands: [["typescript-language-server", "--stdio"]] },
  python: { languageId: "python", commands: [["pyright-langserver", "--stdio"], ["pylsp"]] },
  go: { languageId: "go", commands: [["gopls"]] },
  rust: { languageId: "rust", commands: [["rust-analyzer"]] },
}

export function languageForFile(file: string): string | undefined {
  const ext = file.split(".").pop()?.toLowerCase()
  return ext ? EXT_LANG[ext] : undefined
}

/** Resolve a launchable command for a language, or undefined if no server binary is installed. */
export function resolveServer(language: string): { languageId: string; command: string[] } | undefined {
  const def = SERVERS[language]
  if (!def) return undefined
  for (const cmd of def.commands) {
    if (Bun.which(cmd[0]!)) return { languageId: def.languageId, command: cmd }
  }
  return undefined
}
