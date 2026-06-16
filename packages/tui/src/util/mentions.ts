import fs from "node:fs"
import path from "node:path"

export type ChipKind = "image" | "folder" | "file"
export type Chip = { raw: string; rel: string; abs?: string; kind: ChipKind }

const IMAGE = /\.(png|jpe?g|gif|webp)$/i

/** Resolve a mention/path against the workspace roots; returns the first existing absolute path. */
function resolve(rel: string, roots: string[]): string | undefined {
  const expand = rel.startsWith("~/") && process.env.HOME ? process.env.HOME + rel.slice(1) : rel
  if (path.isAbsolute(expand)) {
    try {
      fs.statSync(expand)
      return expand
    } catch {
      return undefined
    }
  }
  for (const root of roots) {
    const full = path.join(root, expand)
    try {
      fs.statSync(full)
      return full
    } catch {
      /* try next root */
    }
  }
  return undefined
}

function classify(rel: string, abs?: string): ChipKind {
  if (abs) {
    try {
      if (fs.statSync(abs).isDirectory()) return "folder"
    } catch {
      /* fall through */
    }
  } else if (rel.endsWith("/")) return "folder"
  return IMAGE.test(rel) ? "image" : "file"
}

/**
 * Find file references in composer/prompt text and turn them into chips:
 *  - `@path` mentions (the canonical form, completed via the @ autocomplete)
 *  - bare absolute / `~`-rooted paths that actually exist on disk (so a pasted path becomes a chip
 *    instead of a long raw string). We require existence to avoid turning ordinary prose into chips.
 */
export function parseMentions(text: string, roots: string[]): Chip[] {
  const out: Chip[] = []
  const seen = new Set<string>()
  const push = (rel: string) => {
    if (seen.has(rel)) return
    seen.add(rel)
    const abs = resolve(rel, roots)
    out.push({ raw: rel, rel, abs, kind: classify(rel, abs) })
  }

  let m: RegExpExecArray | null
  const at = /(?:^|\s)@([^\s@]+)/g
  while ((m = at.exec(text))) push(m[1]!)

  const bare = /(?:^|\s)(~?\/[^\s@]+)/g
  while ((m = bare.exec(text))) {
    const rel = m[1]!
    if (seen.has(rel) || seen.has("@" + rel)) continue
    if (resolve(rel, roots)) push(rel) // only existing paths become chips
  }
  return out
}

/** Compact icon shown on each chip, by kind. */
export function chipIcon(kind: ChipKind): string {
  return kind === "image" ? "▣" : kind === "folder" ? "▢" : "▤"
}
