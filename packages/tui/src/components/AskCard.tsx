import { For, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { theme, getMode } from "@friday/shared"
import { useApp, type PendingAsk } from "../store.tsx"

/** Inline HITL card for the ask_user tool: a question + optional numbered choices + free text. */
export function AskCard() {
  const app = useApp()
  const accent = () => getMode(app.mode()).accent
  let input: any

  useKeyboard((key) => {
    if (!app.askPending()) return
    const opts = app.askPending()!.options ?? []
    if (key.name === "escape") return app.replyAsk("(no answer)")
    const n = Number(key.name)
    if (!Number.isNaN(n) && n >= 1 && n <= opts.length) return app.replyAsk(opts[n - 1]!)
  })

  function submitFree() {
    const text: string = input?.plainText ?? ""
    app.replyAsk(text.trim() || "(no answer)")
  }

  return (
    <Show when={app.askPending()}>
      {(a: () => PendingAsk) => (
        <box
          flexDirection="column"
          border
          borderStyle="rounded"
          borderColor={theme.info}
          backgroundColor={theme.bgElevated}
          paddingLeft={1}
          paddingRight={1}
          marginBottom={1}
          gap={1}
        >
          <box flexDirection="row" gap={1}>
            <text fg={theme.info}>? friday asks</text>
            <text fg={theme.text}>{a().question}</text>
          </box>
          <Show when={a().options?.length}>
            <box flexDirection="column">
              <For each={a().options}>
                {(opt, i) => (
                  <box flexDirection="row" gap={1} onMouseDown={() => app.replyAsk(opt)}>
                    <text fg={accent()}>{i() + 1}.</text>
                    <text fg={theme.text}>{opt}</text>
                  </box>
                )}
              </For>
            </box>
          </Show>
          <box flexDirection="row" gap={1} alignItems="center">
            <text fg={theme.textFaint}>›</text>
            <box flexGrow={1} border borderStyle="rounded" borderColor={theme.border} paddingLeft={1} paddingRight={1}>
              <textarea
                ref={(r: any) => (input = r)}
                onSubmit={submitFree}
                keyBindings={[{ name: "return", action: "submit" }]}
                focused
                placeholder="type an answer, pick a number, or esc to skip…"
                placeholderColor={theme.textFaint}
                minHeight={1}
                maxHeight={4}
              />
            </box>
          </box>
        </box>
      )}
    </Show>
  )
}
