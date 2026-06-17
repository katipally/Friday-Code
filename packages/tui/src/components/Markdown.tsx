import { useApp } from "../store.tsx"
import { SyntaxStyle } from "@opentui/core"
import { theme, getMode } from "@friday/shared"

/** Markdown renderer using OpenTUI's native `<markdown>` element. */
export function Markdown(props: { content: string }) {
  const app = useApp()
  const accent = () => getMode(app.mode()).accent
  const style = SyntaxStyle.fromStyles({
    text: { fg: theme.text },
    muted: { fg: theme.textMuted },
    faint: { fg: theme.textFaint },
    accent: { fg: accent() },
    info: { fg: theme.info },
    success: { fg: theme.success },
    warning: { fg: theme.warning },
    error: { fg: theme.error },
  })
  return <markdown content={props.content} syntaxStyle={style} fg={theme.text} bg={theme.bg} />
}
