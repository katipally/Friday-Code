import { readClipboard } from "./clipboard.ts"

/**
 * Inline paste tokens for the composer. A large/multi-line paste is collapsed to a short
 * placeholder token inserted at the cursor (so the "chip" sits exactly where it was pasted and the
 * buffer stays compact), while the real content is held in a side map and expanded back on submit.
 */

function fmtSize(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`
}

/** The visible placeholder for the Nth paste of `len` chars, e.g. `⟦paste 1 · 2.3k⟧`. */
export function makePasteToken(n: number, len: number): string {
  return `⟦paste ${n} · ${fmtSize(len)}⟧`
}

/**
 * Whether a pasted string is "big" enough to collapse into a token rather than inserting inline.
 * Short single-line pastes (a path, a word) flow in as normal text; only bulky/multi-line content
 * becomes a chip.
 */
export function isBigPaste(text: string): boolean {
  return text.length > 240 || (text.includes("\n") && text.length > 80)
}

/** Replace every still-present token in `text` with its stored content (orphaned tokens are skipped). */
export function expandTokens(text: string, map: Map<string, string>): string {
  let out = text
  for (const [token, content] of map) {
    if (out.includes(token)) out = out.split(token).join(content)
  }
  return out
}

/** Strip simple ANSI SGR sequences a terminal may wrap a paste in. */
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "")
}

/**
 * Per-composer paste store. A big/multi-line paste collapses to a placeholder token inserted at the
 * cursor (the real content held here, expanded back on submit); a small paste flows in inline. Shared
 * by the main composer, the /steer modal, and the ask_user card so paste behaves identically in all.
 */
export function createPasteStore() {
  const pastes = new Map<string, string>()
  let n = 0
  function insert(ta: any, raw: string): boolean {
    const txt = stripAnsi(raw ?? "")
    if (!txt) return false
    if (isBigPaste(txt)) {
      const token = makePasteToken(++n, txt.length)
      pastes.set(token, txt)
      ta?.insertText?.(token)
    } else {
      ta?.insertText?.(txt)
    }
    return true
  }
  /**
   * Insert a file/image reference as a SHORT inline token (`⟦▣ name⟧`) mapped to the full `@path`
   * mention. The user sees the short name interleaved where they pasted; on submit it expands to
   * `@/full/path` so the model/runner gets the real path (and reads the image/file).
   */
  function insertMention(ta: any, fullPath: string): boolean {
    if (!fullPath) return false
    const name = fullPath.split("/").pop() || fullPath
    const img = /\.(png|jpe?g|gif|webp)$/i.test(name)
    const value = `@${fullPath} `
    let token = `⟦${img ? "▣" : "▤"} ${name}⟧`
    if (pastes.has(token) && pastes.get(token) !== value) token = `⟦${img ? "▣" : "▤"} ${name} ${++n}⟧`
    pastes.set(token, value)
    ta?.insertText?.(token)
    return true
  }
  return {
    pastes,
    insert,
    insertMention,
    /** Tokens currently present in `text` (drops chips the user deleted from the buffer). */
    live(text: string): string[] {
      return [...pastes.keys()].filter((t) => text.includes(t))
    },
    expand(text: string): string {
      return expandTokens(text, pastes)
    },
    clear(): void {
      pastes.clear()
      n = 0
    },
  }
}

export type PasteStore = ReturnType<typeof createPasteStore>

/**
 * Whether a key event is a "paste from clipboard" chord. Ctrl+V everywhere; Cmd+V on macOS arrives as
 * super/meta+V on kitty-protocol terminals (others intercept Cmd+V and deliver it as a bracketed paste,
 * handled separately by onPaste).
 */
export function isPasteKey(key: { name?: string; ctrl?: boolean; meta?: boolean; super?: boolean }): boolean {
  return key.name === "v" && (!!key.ctrl || !!key.meta || !!key.super)
}

/**
 * Paste from the system clipboard into a textarea: text tokenizes as usual; an image or file becomes
 * an `@path` mention (the runner reads it — images → base64, files → content). Returns whether it
 * inserted anything. The image case writes a temp PNG (readClipboard handles that) so a screenshot in
 * the clipboard attaches just like a saved `@image.png`.
 */
export function pasteFromClipboard(ta: any, store: PasteStore): boolean {
  const clip = readClipboard()
  if (clip.kind === "text") return store.insert(ta, clip.text)
  if (clip.kind === "image" || clip.kind === "file") return store.insertMention(ta, clip.path)
  return false
}

/** Build the click-to-open Preview for a live token, from its stored expansion (`@path` → file/image). */
export function tokenPreview(
  token: string,
  value: string,
): { kind: "text" | "file" | "image"; title: string; text: string; path: string } {
  const v = value.trimStart()
  if (v.startsWith("@")) {
    const path = v.slice(1).trim()
    const name = path.split("/").pop() || path
    const img = /\.(png|jpe?g|gif|webp)$/i.test(name)
    return { kind: img ? "image" : "file", title: name, text: "", path }
  }
  return { kind: "text", title: token.replace(/^⟦|⟧$/g, ""), text: value, path: "" }
}
