import { theme } from "@friday/shared"
import { chipIcon, type Chip } from "../util/mentions.ts"
import { useHover } from "../motion/index.ts"

/** A click-to-open file reference chip with a hover highlight. */
export function FileChip(props: {
  chip: Chip
  accent: string
  onOpen: () => void
  max?: number
}) {
  const h = useHover({ base: theme.bg, hover: theme.bgHover })
  const name = () => {
    const n = props.chip.rel.split("/").pop() || props.chip.rel
    return props.max && n.length > props.max ? n.slice(0, props.max - 1) + "…" : n
  }
  return (
    <box
      border
      borderStyle="rounded"
      borderColor={props.chip.abs ? props.accent : h.hovered() ? theme.borderActive : theme.border}
      backgroundColor={h.bg()}
      paddingLeft={1}
      paddingRight={1}
      onMouseOver={h.onMouseOver}
      onMouseOut={h.onMouseOut}
      onMouseDown={props.onOpen}
    >
      <text fg={props.chip.abs || h.hovered() ? theme.text : theme.textFaint}>
        {chipIcon(props.chip.kind)} {name()}
      </text>
    </box>
  )
}
