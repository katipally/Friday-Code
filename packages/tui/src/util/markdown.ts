/** A tiny, dependency-free markdown model (reliable in a TUI; no async tree-sitter). */
export type MdBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "code"; lang: string; lines: string[] }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; lines: string[] }
  | { type: "hr" }
  | { type: "para"; text: string }

const BLOCK_START = /^(#{1,6}\s|```|>\s?|\s*([-*+]|\d+\.)\s+|(-{3,}|\*{3,}|_{3,})\s*$)/

export function parseMarkdown(src: string): MdBlock[] {
  const lines = src.replace(/\r/g, "").split("\n")
  const blocks: MdBlock[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim()
      const code: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i]!)) code.push(lines[i++]!)
      i++ // closing fence
      blocks.push({ type: "code", lang, lines: code })
      continue
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      blocks.push({ type: "heading", level: h[1]!.length, text: h[2]! })
      i++
      continue
    }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: "hr" })
      i++
      continue
    }
    if (/^>\s?/.test(line)) {
      const q: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i]!)) q.push(lines[i++]!.replace(/^>\s?/, ""))
      blocks.push({ type: "quote", lines: q })
      continue
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line)
      const items: string[] = []
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i]!)) {
        items.push(lines[i++]!.replace(/^\s*([-*+]|\d+\.)\s+/, ""))
      }
      blocks.push({ type: "list", ordered, items })
      continue
    }
    if (line.trim() === "") {
      i++
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i]!.trim() !== "" && !BLOCK_START.test(lines[i]!)) para.push(lines[i++]!)
    blocks.push({ type: "para", text: para.join("\n") })
  }
  return blocks
}

export type Inline = { text: string; bold?: boolean; italic?: boolean; code?: boolean; href?: string }

/** Parse inline emphasis / code / links into styled segments. */
export function parseInline(s: string): Inline[] {
  const out: Inline[] = []
  const re = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|_([^_\n]+)_|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ text: s.slice(last, m.index) })
    if (m[2] !== undefined || m[3] !== undefined) out.push({ text: (m[2] ?? m[3])!, bold: true })
    else if (m[4] !== undefined || m[5] !== undefined) out.push({ text: (m[4] ?? m[5])!, italic: true })
    else if (m[6] !== undefined) out.push({ text: m[6], code: true })
    else if (m[7] !== undefined) out.push({ text: m[7], href: m[8] })
    last = re.lastIndex
  }
  if (last < s.length) out.push({ text: s.slice(last) })
  return out.length ? out : [{ text: s }]
}
