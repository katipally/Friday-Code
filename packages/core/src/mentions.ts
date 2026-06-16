import fs from "node:fs"
import path from "node:path"
import type { ImagePart } from "@friday/shared"

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
}

export function isImagePath(p: string): boolean {
  const ext = p.split(".").pop()?.toLowerCase()
  return !!ext && ext in IMAGE_MIME
}

/** Resolve a mention against the workspace roots; returns the absolute path of the first file match. */
function resolveMention(rel: string, roots: string[]): string | undefined {
  if (path.isAbsolute(rel)) {
    try {
      return fs.statSync(rel).isFile() ? rel : undefined
    } catch {
      return undefined
    }
  }
  for (const root of roots) {
    const full = path.join(root, rel)
    try {
      if (fs.statSync(full).isFile()) return full
    } catch {
      /* try next root */
    }
  }
  return undefined
}

/** Expand `@path` file mentions into appended <file> blocks. Image mentions are skipped (see collectImages). */
export function expandMentions(text: string, roots: string[]): { text: string; files: string[] } {
  const matches: { rel: string; full: string }[] = []
  const re = /(?:^|\s)@([^\s@]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const rel = m[1]!
    if (isImagePath(rel)) continue // images are attached, not inlined as text
    const full = resolveMention(rel, roots)
    if (full && !matches.some((x) => x.full === full)) matches.push({ rel, full })
  }
  if (!matches.length) return { text, files: [] }
  const blocks = matches
    .map((x) => {
      try {
        return `<file path="${x.rel}">\n${fs.readFileSync(x.full, "utf8").slice(0, 20_000)}\n</file>`
      } catch {
        return ""
      }
    })
    .filter(Boolean)
  return { text: `${text}\n\n${blocks.join("\n\n")}`, files: matches.map((x) => x.rel) }
}

/** Collect `@image.png` mentions as base64 image parts to attach to the user message. */
export function collectImages(text: string, roots: string[]): ImagePart[] {
  const out: ImagePart[] = []
  const re = /(?:^|\s)@([^\s@]+)/g
  let m: RegExpExecArray | null
  const seen = new Set<string>()
  while ((m = re.exec(text))) {
    const rel = m[1]!
    const ext = rel.split(".").pop()?.toLowerCase()
    if (!ext || !(ext in IMAGE_MIME)) continue
    const full = resolveMention(rel, roots)
    if (!full || seen.has(full)) continue
    seen.add(full)
    try {
      out.push({ data: fs.readFileSync(full).toString("base64"), mime: IMAGE_MIME[ext]! })
    } catch {
      /* skip unreadable */
    }
  }
  return out
}
