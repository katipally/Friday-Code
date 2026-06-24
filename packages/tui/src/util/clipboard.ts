import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

/**
 * Copy text to the system clipboard.
 *
 * OSC52 (the terminal escape route) is unreliable — macOS Terminal.app ignores it by default —
 * so locally we shell out to the platform clipboard tool, which always works. We still emit OSC52
 * as a fallback (useful over SSH / in terminals that support it) when no native tool is available.
 */
export function copyText(text: string, renderer?: { copyToClipboardOSC52?: (t: string) => void }): boolean {
  const cmd =
    process.platform === "darwin"
      ? ["pbcopy"]
      : process.platform === "win32"
        ? ["clip"]
        : ["xclip", "-selection", "clipboard"]
  try {
    const res = spawnSync(cmd[0]!, cmd.slice(1), { input: text })
    if (!res.error && res.status === 0) return true
  } catch {}
  // Fallback: ask the terminal to copy via OSC52.
  try {
    renderer?.copyToClipboardOSC52?.(text)
    return true
  } catch {}
  return false
}

/**
 * Read text from the system clipboard. The reliable path for paste: bracketed-paste (the terminal
 * sending the buffer on Ctrl+V) is not supported everywhere, so we shell out to the platform tool
 * and let the app bind its own paste key. Returns "" when nothing is available.
 */
export function readText(): string {
  const candidates =
    process.platform === "darwin"
      ? [["pbpaste"]]
      : process.platform === "win32"
        ? [["powershell", "-NoProfile", "-Command", "Get-Clipboard"]]
        : [
            ["xclip", "-selection", "clipboard", "-o"],
            ["xsel", "--clipboard", "--output"],
            ["wl-paste", "--no-newline"],
          ]
  for (const cmd of candidates) {
    try {
      const res = spawnSync(cmd[0]!, cmd.slice(1), { encoding: "utf8" })
      if (!res.error && res.status === 0 && typeof res.stdout === "string") return res.stdout
    } catch {}
  }
  return ""
}

/** What the system clipboard holds right now. Used by paste so an image/file becomes an attachment. */
export type Clip =
  | { kind: "text"; text: string }
  | { kind: "image"; path: string } // a temp PNG we wrote from the clipboard's image data
  | { kind: "file"; path: string } // an existing on-disk file (copied in Finder/Explorer)
  | { kind: "empty" }

/** Run an AppleScript snippet, returning trimmed stdout ("" on any failure). macOS only. */
function osa(script: string): string {
  try {
    const res = spawnSync("osascript", ["-e", script], { encoding: "utf8" })
    if (!res.error && res.status === 0) return (res.stdout ?? "").trim()
  } catch {}
  return ""
}

function nonEmptyFile(p: string): boolean {
  try {
    return fs.statSync(p).size > 0
  } catch {
    return false
  }
}

/**
 * Read the clipboard as a typed attachment. On macOS we inspect `clipboard info` first (coercing text
 * to «class furl» FALSELY succeeds, so try/catch alone isn't enough) and pull image bytes or a file
 * URL when present; otherwise fall back to text. Other platforms: text only for now.
 */
export function readClipboard(): Clip {
  if (process.platform === "darwin") {
    const info = osa("clipboard info")
    if (/PNGf|TIFF|«class PICT»/.test(info)) {
      const out = path.join(os.tmpdir(), `friday-clip-${process.pid}-${Date.now()}.png`)
      const ok = osa(
        `try\nset png to (the clipboard as «class PNGf»)\nset f to open for access (POSIX file ${JSON.stringify(out)}) with write permission\nset eof f to 0\nwrite png to f\nclose access f\nreturn "ok"\non error\nreturn ""\nend try`,
      )
      if (ok === "ok" && nonEmptyFile(out)) return { kind: "image", path: out }
    }
    if (/furl/.test(info)) {
      const p = osa('try\nreturn POSIX path of (the clipboard as «class furl»)\non error\nreturn ""\nend try')
      if (p && fs.existsSync(p)) return { kind: "file", path: p }
    }
  }
  const t = readText()
  return t ? { kind: "text", text: t } : { kind: "empty" }
}
