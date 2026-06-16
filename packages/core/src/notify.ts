/**
 * Best-effort desktop + terminal notifications for background-session events.
 * Silent no-op on failure (missing binary, headless, etc). Set
 * FRIDAY_NO_NOTIFY=1 to disable.
 */
function osNotify(title: string, body: string): void {
  try {
    if (process.platform === "darwin") {
      const esc = (s: string) => s.replace(/"/g, '\\"')
      Bun.spawn(["osascript", "-e", `display notification "${esc(body)}" with title "${esc(title)}"`], {
        stdout: "ignore",
        stderr: "ignore",
      })
    } else if (process.platform === "linux") {
      Bun.spawn(["notify-send", title, body], { stdout: "ignore", stderr: "ignore" })
    }
  } catch {
    /* ignore */
  }
}

export function notify(title: string, body: string): void {
  if (process.env.FRIDAY_NO_NOTIFY === "1") return
  // Terminal bell — works even when no desktop notifier is present.
  try {
    process.stdout.write("\x07")
  } catch {
    /* ignore */
  }
  osNotify(title, body)
}
