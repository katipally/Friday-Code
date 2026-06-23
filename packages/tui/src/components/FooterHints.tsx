import { theme } from "@friday/shared"
import { For } from "solid-js"
import { useHover } from "../motion/index.ts"
import { useApp } from "../store.tsx"

type Hint = { keys: string; label: string; act?: "mode" | "panel" | "cmds" }

const HINTS: Hint[] = [
  { keys: "enter", label: "send" },
  { keys: "shift+tab", label: "mode", act: "mode" },
  { keys: "ctrl+b", label: "panel", act: "panel" },
  { keys: "ctrl+k", label: "cmds", act: "cmds" },
  { keys: "/", label: "command" },
  { keys: "@", label: "file" },
  { keys: "ctrl+c", label: "quit" },
]

/** One key hint. Actionable ones (mode/panel/cmds/?keys) brighten on hover and fire on click, so the
 *  hints double as mouse targets; the rest render flat. */
function FooterHint(props: { keys: string; label: string; onClick?: () => void; armed?: boolean }) {
  const interactive = () => !!props.onClick
  const h = useHover({ base: "transparent", hover: theme.bgHover })
  const keyFg = () => (props.armed ? theme.warning : interactive() && h.hovered() ? theme.brand : theme.text)
  return (
    <box
      flexDirection="row"
      gap={1}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={interactive() ? h.bg() : "transparent"}
      onMouseOver={interactive() ? h.onMouseOver : undefined}
      onMouseOut={interactive() ? h.onMouseOut : undefined}
      onMouseDown={props.onClick}
    >
      <text fg={keyFg()}>{props.keys}</text>
      <text fg={props.armed ? theme.warning : theme.textFaint}>
        {props.armed ? "press again to exit" : props.label}
      </text>
    </box>
  )
}

/** Contextual key hints — each is clickable where it maps to an action; "? keys" opens the guide. */
export function FooterHints() {
  const app = useApp()
  const handler = (act?: Hint["act"]) =>
    act === "mode"
      ? () => app.toggleMode(1)
      : act === "panel"
        ? () => app.setRightOpen(!app.rightOpen())
        : act === "cmds"
          ? () => app.setPaletteOpen(true)
          : undefined
  return (
    <box flexDirection="row" height={1} paddingLeft={1} paddingRight={1} gap={1} alignItems="center">
      <For each={HINTS}>
        {(h) => (
          <FooterHint
            keys={h.keys}
            label={h.label}
            armed={h.keys === "ctrl+c" && app.quitArmed()}
            onClick={handler(h.act)}
          />
        )}
      </For>
      <box flexGrow={1} />
      <FooterHint keys="?" label="keys" onClick={() => app.setOverlayOpen(true)} />
    </box>
  )
}
