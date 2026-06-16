import { For, Show } from "solid-js"
import { theme } from "@friday/shared"

export type SelectItem = {
  id: string
  label: string
  hint?: string
  /** A keycap hotkey shown on the left, e.g. "a" or "1". */
  key?: string
  /** Tint for the keycap/label (defaults to the list accent). */
  color?: string
}

/**
 * Shared, presentational selectable list used by the slash palette, permission card,
 * and ask card so all three feel identical. Rendering + mouse (click/hover) live here;
 * each parent owns its own keyboard handling (filter vs hotkeys vs free-text differ),
 * which keeps key semantics conflict-free while the look stays uniform.
 */
export function SelectList(props: {
  items: SelectItem[]
  selected: number
  accent: string
  /** Multi-select: show ☑/☐ and mark these ids checked. */
  multi?: boolean
  checked?: Set<string>
  onHover?: (i: number) => void
  onChoose: (i: number) => void
}) {
  return (
    <box flexDirection="column">
      <For each={props.items}>
        {(it, i) => {
          const on = () => props.selected === i()
          const tint = () => it.color ?? props.accent
          const isChecked = () => props.checked?.has(it.id)
          return (
            <box
              flexDirection="row"
              gap={1}
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={on() ? theme.bgHover : "transparent"}
              onMouseOver={() => props.onHover?.(i())}
              onMouseDown={() => props.onChoose(i())}
            >
              <text fg={on() ? tint() : theme.textFaint}>{on() ? "▸" : " "}</text>
              <Show when={props.multi}>
                <text fg={isChecked() ? theme.success : theme.textFaint}>{isChecked() ? "◉" : "○"}</text>
              </Show>
              <Show when={it.key}>
                <box border borderStyle="rounded" borderColor={tint()} paddingLeft={1} paddingRight={1}>
                  <text fg={tint()}>{it.key}</text>
                </box>
              </Show>
              <text fg={on() ? theme.text : theme.textMuted}>{it.label}</text>
              <Show when={it.hint}>
                <box flexGrow={1} />
                <text fg={theme.textFaint}>{it.hint}</text>
              </Show>
            </box>
          )
        }}
      </For>
    </box>
  )
}
