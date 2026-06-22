import { theme } from "@friday/shared"
import { decodePasteBytes } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { useApp } from "../store.tsx"
import { expandTokens, isBigPaste, makePasteToken } from "../util/attachments.ts"
import { Scrim } from "./Scrim.tsx"

/**
 * /add composer: steer the running agent without stopping it. The agent keeps working (soft-paused at
 * the next step boundary if you opened this bare); on send the note is folded into the conversation and
 * the agent resumes. `@file` / `@image` mentions are resolved by the runner, same as a normal prompt.
 */
export function AddModal() {
  const app = useApp()
  const dims = useTerminalDimensions()
  const maxHeight = () => Math.max(4, Math.floor(dims().height / 3))

  let ta: any
  const pastes = new Map<string, string>()
  let pasteN = 0

  function send() {
    const raw: string = ta?.plainText ?? ""
    app.addInject(expandTokens(raw, pastes)) // paste tokens → full content; runner expands @mentions/images
  }

  // Big/multi-line pastes collapse to a placeholder, expanded back on send (same as the main composer).
  const onPaste = (event: any) => {
    try {
      const txt = (decodePasteBytes(event?.bytes) ?? "").replace(/\x1b\[[0-9;]*m/g, "")
      if (!isBigPaste(txt)) return
      event?.preventDefault?.()
      const token = makePasteToken(++pasteN, txt.length)
      pastes.set(token, txt)
      ta?.insertText?.(token)
    } catch {
      /* fall through to default paste */
    }
  }

  useKeyboard((key) => {
    if (!app.addModalOpen()) return
    if (key.name === "escape") app.addCancel()
  })

  return (
    <Scrim onClose={() => app.addCancel()}>
      <box
        flexDirection="column"
        width={Math.min(72, dims().width - 4)}
        border
        borderStyle="single"
        borderColor={theme.border}
        backgroundColor={theme.bgElevated}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        gap={1}
      >
        <box flexDirection="row" gap={1}>
          <text fg={theme.textMuted}>/add</text>
          <text fg={theme.textFaint}>· steer the agent — it keeps working and folds this in next step</text>
        </box>

        <box
          border
          borderStyle="single"
          borderColor={theme.border}
          backgroundColor={theme.bgComposer}
          paddingLeft={1}
          paddingRight={1}
        >
          <textarea
            ref={(r: any) => {
              ta = r
              if (r) r.onPaste = onPaste
            }}
            onSubmit={send}
            keyBindings={[
              { name: "return", action: "submit" },
              { name: "return", shift: true, action: "newline" },
            ]}
            focused
            placeholder="what should the agent also know?   @file · @image.png · ⇧⏎ newline"
            placeholderColor={theme.textFaint}
            textColor={theme.text}
            backgroundColor={theme.bgComposer}
            minHeight={2}
            maxHeight={maxHeight()}
          />
        </box>

        <text fg={theme.textFaint}>⏎ send · esc cancel (resumes the agent)</text>
      </box>
    </Scrim>
  )
}
