import { theme } from "@friday/shared"
import { syntaxStyle } from "../util/syntax.ts"

/** Diff card using OpenTUI's native `<diff>` renderable.
 *  Tool diffs are lightweight unified lines without file/hunk headers, so we
 *  normalise them into a parseable patch before handing them to OpenTUI.
 */
export function DiffCard(props: { diff: string }) {
  const diff = () => {
    const d = props.diff.trim()
    if (!d) return ""
    // Already a full patch?
    if (d.includes("--- ") && d.includes("+++ ")) return d
    // Wrap raw +/- lines in a synthetic hunk so the parser renders them.
    const lines = d.split("\n")
    const added = lines.filter((l) => l.startsWith("+")).length
    const removed = lines.filter((l) => l.startsWith("-")).length
    return `--- a/file\n+++ b/file\n@@ -1,${removed} +1,${added} @@\n${d}`
  }
  return (
    <box border borderStyle="rounded" borderColor={theme.borderMuted} backgroundColor={theme.bg} paddingLeft={1} paddingRight={1}>
      <diff
        diff={diff()}
        view="unified"
        syntaxStyle={syntaxStyle()}
        fg={theme.textMuted}
        addedBg={theme.diffAddedBg}
        removedBg={theme.diffRemovedBg}
        addedSignColor={theme.diffAdded}
        removedSignColor={theme.diffRemoved}
      />
    </box>
  )
}
