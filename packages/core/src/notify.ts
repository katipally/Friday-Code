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
    } else if (process.platform === "win32") {
      // WinRT toast via PowerShell. Single-quoted PS strings escape ' by doubling it.
      const esc = (s: string) => s.replace(/'/g, "''")
      const ps =
        "[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]>$null;" +
        "$t=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);" +
        "$x=$t.GetElementsByTagName('text');" +
        `$x.Item(0).AppendChild($t.CreateTextNode('${esc(title)}'))>$null;` +
        `$x.Item(1).AppendChild($t.CreateTextNode('${esc(body)}'))>$null;` +
        "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Friday').Show([Windows.UI.Notifications.ToastNotification]::new($t));"
      Bun.spawn(["powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", ps], {
        stdout: "ignore",
        stderr: "ignore",
      })
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
