import { For, Show } from "solid-js"
import { theme } from "@friday/shared"
import { useApp } from "../store.tsx"
import { Appear } from "../motion/index.ts"

/** Transient notifications, stacked at the bottom-right — e.g. a background session finished. */
export function Toasts() {
  const app = useApp()
  const color = (k: string) => (k === "error" ? theme.error : k === "input" ? theme.warning : theme.success)
  return (
    <Show when={app.toasts().length}>
      <box position="absolute" bottom={2} right={2} flexDirection="column" gap={1} alignItems="flex-end">
        <For each={app.toasts()}>
          {(t) => (
            <Appear distance={1} duration={160}>
              <box border borderStyle="rounded" borderColor={color(t.kind)} backgroundColor={theme.bgElevated} paddingLeft={1} paddingRight={1}>
                <text fg={color(t.kind)}>{t.text}</text>
              </box>
            </Appear>
          )}
        </For>
      </box>
    </Show>
  )
}
