import { theme } from "@friday/shared"
import { syntaxStyle } from "../util/syntax.ts"

/**
 * Markdown renderer using OpenTUI's native `<markdown>` element.
 * The shared SyntaxStyle (real tree-sitter scopes) drives heading/emphasis/link styling
 * and fenced-code syntax highlighting. `streaming` keeps the trailing block stable while
 * tokens are still arriving, then callers flip it off when the turn completes.
 */
export function Markdown(props: { content: string; streaming?: boolean }) {
  return (
    <markdown
      content={props.content}
      syntaxStyle={syntaxStyle()}
      fg={theme.text}
      streaming={props.streaming ?? false}
    />
  )
}
