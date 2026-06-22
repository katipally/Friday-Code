import { theme } from "@friday/shared"
import type { SelectOption } from "@opentui/core"

export type SelectItem = {
  id: string
  label: string
  hint?: string
  /** A keycap hotkey shown on the left, e.g. "a" or "1". */
  key?: string
  /** Tint for the keycap/label (defaults to the list accent). */
  color?: string
}

/** Convert Friday SelectItems to OpenTUI SelectOptions. */
export function toOptions(items: SelectItem[]): SelectOption[] {
  return items.map((it) => ({
    name: it.label,
    description: it.hint ?? "",
    value: it.id,
  }))
}

/**
 * Shared presentational selectable list using OpenTUI's native `<select>`.
 * Note: OpenTUI handles its own up/down/enter key focus; callers should still
 * handle custom hotkeys (a/s/d, number keys) at the modal level.
 */
export function SelectList(props: {
  items: SelectItem[]
  selected: number
  accent?: string
  /** Multi-select is not supported by the native select; keep a checkbox row above if needed. */
  multi?: boolean
  checked?: Set<string>
  onHover?: (i: number) => void
  onChange?: (i: number) => void
  onChoose: (i: number) => void
  /** Max visible rows before the list scrolls internally (native select needs a bounded height). */
  maxRows?: number
}) {
  // The native <select> only paginates/scrolls when it has a definite height; without one it
  // lays out every row (overflowing its container with no scrollbar). Bound it to maxRows.
  const rows = () => Math.min(Math.max(1, props.items.length), props.maxRows ?? 10)
  // Native <select> is single-select and shows no per-row check state, so for multi-select
  // we fold the checkbox glyph into the option label to keep the chosen set visible.
  const options = () =>
    props.items.map((it) => ({
      name: props.multi ? `${props.checked?.has(it.id) ? "☑" : "☐"} ${it.label}` : it.label,
      description: it.hint ?? "",
      value: it.id,
    }))
  return (
    <select
      height={rows()}
      wrapSelection
      options={options()}
      selectedIndex={props.selected}
      backgroundColor={theme.bgElevated}
      textColor={theme.textMuted}
      focusedBackgroundColor={theme.bgHover}
      focusedTextColor={theme.text}
      selectedBackgroundColor={theme.bgSelected}
      selectedTextColor={theme.textOnAccent}
      descriptionColor={theme.textFaint}
      selectedDescriptionColor={theme.textFaint}
      onChange={(i) => props.onHover?.(i)}
      onSelect={(i) => props.onChoose(i)}
      showDescription={true}
      showScrollIndicator={true}
    />
  )
}
