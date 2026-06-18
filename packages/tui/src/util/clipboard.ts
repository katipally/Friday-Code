import { spawnSync } from "node:child_process"

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
