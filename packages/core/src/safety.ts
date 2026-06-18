/** Heuristics for flagging risky shell commands + matching allow/deny lists. */

const RISKY: { re: RegExp; note: string }[] = [
  { re: /\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r/i, note: "recursive force delete (rm -rf)" },
  { re: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(sh|bash|zsh)/i, note: "pipes a download into a shell" },
  { re: /\bgit\s+push\b/i, note: "pushes to a remote" },
  { re: /\bsudo\b/i, note: "runs as root (sudo)" },
  { re: /\b(mkfs|dd)\b/i, note: "low-level disk write" },
  { re: />\s*\/dev\/(sd|disk|nvme)/i, note: "writes to a raw device" },
  { re: /\bchmod\s+-R\b/i, note: "recursive permission change" },
  { re: /:\s*\(\s*\)\s*\{.*\|.*&\s*\}\s*;/, note: "possible fork bomb" },
  { re: /\bnpm\s+publish\b|\byarn\s+publish\b/i, note: "publishes a package" },
]

/** Return a short risk note if the command looks dangerous, else undefined. */
export function bashRisk(command: string): string | undefined {
  for (const r of RISKY) if (r.re.test(command)) return r.note
  return undefined
}

/** A command matches a list entry if it equals/starts-with it, or matches it as a `*` glob. */
export function matchesList(command: string, patterns?: string[]): boolean {
  if (!patterns?.length) return false
  const cmd = command.trim()
  for (const p of patterns) {
    if (p === "*") return true
    if (p.includes("*")) {
      const re = new RegExp(
        "^" +
          p
            .split("*")
            .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join(".*"),
      )
      if (re.test(cmd)) return true
    } else if (cmd === p || cmd.startsWith(`${p} `) || cmd.startsWith(p)) {
      return true
    }
  }
  return false
}
