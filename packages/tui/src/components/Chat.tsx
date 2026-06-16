import { For } from "solid-js"
import { theme, getMode } from "@friday/shared"
import { useApp, type ChatMsg } from "../store.tsx"

function Bubble(props: { msg: ChatMsg }) {
  const app = useApp()
  const isUser = () => props.msg.role === "user"
  const accent = () => getMode(app.mode()).accent
  const color = () => (isUser() ? theme.user : accent())

  return (
    <box
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={color()}
      backgroundColor={theme.bg}
      paddingLeft={1}
      paddingRight={1}
      marginBottom={1}
    >
      <text fg={color()}>{isUser() ? "you" : "⬡ friday"}</text>
      <text fg={theme.text} selectable>
        {props.msg.text}
      </text>
    </box>
  )
}

/** Center conversation area — sticky-to-bottom scroll of message bubbles. */
export function Chat() {
  const app = useApp()
  return (
    <scrollbox flexGrow={1} stickyScroll stickyStart="bottom" paddingTop={1}>
      <For each={app.messages()}>{(msg) => <Bubble msg={msg} />}</For>
    </scrollbox>
  )
}
