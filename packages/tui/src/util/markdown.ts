/** A tiny, dependency-free markdown model (reliable in a TUI; no async tree-sitter). */
export type MdListItem = { text: string; depth: number; ordered: boolean; index: number; task?: boolean; checked?: boolean }
export type MdBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "code"; lang: string; lines: string[] }
  | { type: "list"; items: MdListItem[] }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "quote"; lines: string[] }
  | { type: "hr" }
  | { type: "para"; text: string }

const LIST_RE = /^(\s*)([-*+]|\d+\.)\s+(.*)$/
const BLOCK_START = /^(#{1,6}\s|```|>\s?|\s*([-*+]|\d+\.)\s+|(-{3,}|\*{3,}|_{3,})\s*$)/

/** A GFM table needs a header row of pipes and a `| --- | --- |` separator beneath it. */
function isTableStart(lines: string[], i: number): boolean {
  const head = lines[i]
  const sep = lines[i + 1]
  if (!head || !sep || !head.includes("|")) return false
  return /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(sep) && sep.includes("-")
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim())
}

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
    if (isTableStart(lines, i)) {
      const headers = splitRow(lines[i]!)
      i += 2 // header + separator
      const rows: string[][] = []
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim() !== "") rows.push(splitRow(lines[i++]!))
      blocks.push({ type: "table", headers, rows })
      continue
    }
    if (/^>\s?/.test(line)) {
      const q: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i]!)) q.push(lines[i++]!.replace(/^>\s?/, ""))
      blocks.push({ type: "quote", lines: q })
      continue
    }
    if (LIST_RE.test(line)) {
      const items: MdListItem[] = []
      let counter = 0
      while (i < lines.length && LIST_RE.test(lines[i]!)) {
        const m = lines[i++]!.match(LIST_RE)!
        const depth = Math.floor(m[1]!.replace(/\t/g, "  ").length / 2)
        const ordered = /\d+\./.test(m[2]!)
        let text = m[3]!
        const task = text.match(/^\[([ xX])\]\s+(.*)$/)
        items.push({
          text: task ? task[2]! : text,
          depth,
          ordered,
          index: ordered ? ++counter : 0,
          task: !!task,
          checked: task ? task[1]!.toLowerCase() === "x" : undefined,
        })
      }
      blocks.push({ type: "list", items })
      continue
    }
    if (line.trim() === "") {
      i++
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i]!.trim() !== "" && !BLOCK_START.test(lines[i]!) && !isTableStart(lines, i)) para.push(lines[i++]!)
    if (para.length) blocks.push({ type: "para", text: para.join("\n") })
    else if (i < lines.length) {
      // A line that looked like a block-start but matched nothing above (e.g. stray pipe): treat as paragraph.
      blocks.push({ type: "para", text: lines[i++]! })
    }
  }
  return blocks
}

export type Inline = { text: string; bold?: boolean; italic?: boolean; code?: boolean; strike?: boolean; href?: string }

/** Parse inline emphasis / code / strikethrough / links into styled segments. */
export function parseInline(s: string): Inline[] {
  const out: Inline[] = []
  const re = /(\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|\*([^*\n]+)\*|_([^_\n]+)_|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ text: s.slice(last, m.index) })
    if (m[2] !== undefined || m[3] !== undefined) out.push({ text: (m[2] ?? m[3])!, bold: true })
    else if (m[4] !== undefined) out.push({ text: m[4], strike: true })
    else if (m[5] !== undefined || m[6] !== undefined) out.push({ text: (m[5] ?? m[6])!, italic: true })
    else if (m[7] !== undefined) out.push({ text: m[7], code: true })
    else if (m[8] !== undefined) out.push({ text: m[8], href: m[9] })
    last = re.lastIndex
  }
  if (last < s.length) out.push({ text: s.slice(last) })
  return out.length ? out : [{ text: s }]
}
