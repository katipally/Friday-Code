import { theme } from "@friday/shared"
import { useHover } from "../motion/index.ts"
import { type Chip, chipIcon } from "../util/mentions.ts"

/** A click-to-open file reference chip with a hover highlight. */
export function FileChip(props: { chip: Chip; accent: string; onOpen: () => void; max?: number }) {
  const h = useHover({ base: theme.bg, hover: theme.bgHover })
  const name = () => {
    const n = props.chip.rel.split("/").pop() || props.chip.rel
    return props.max && n.length > props.max ? `${n.slice(0, props.max - 1)}…` : n
  }
  return (
    <box
      backgroundColor={h.hovered() ? theme.bgHover : theme.bgElevated}
      paddingLeft={1}
      paddingRight={1}
      onMouseOver={h.onMouseOver}
      onMouseOut={h.onMouseOut}
      onMouseDown={props.onOpen}
    >
      {/* borderless chip — an absolute-path ref is flagged by tinting its label with the accent. */}
      <text fg={props.chip.abs ? props.accent : h.hovered() ? theme.text : theme.textMuted}>
        {chipIcon(props.chip.kind)} {name()}
      </text>
    </box>
  )
}
