import { For, Match, Show, Switch } from "solid-js"
import { theme, getMode } from "@friday/shared"
import { useApp, type ViewItem } from "../store.tsx"
import { ThinkingCard } from "./ThinkingCard.tsx"
import { ToolCard } from "./ToolCard.tsx"
import { Logo } from "./Logo.tsx"

function UserBubble(props: { item: Extract<ViewItem, { kind: "user" }> }) {
  return (
    <box
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={theme.user}
      paddingLeft={1}
      paddingRight={1}
      marginBottom={1}
    >
      <text fg={theme.user}>you</text>
      <text fg={theme.text} selectable>
        {props.item.text}
      </text>
    </box>
  )
}

function AssistantMessage(props: { item: Extract<ViewItem, { kind: "assistant" }> }) {
  const app = useApp()
  const accent = () => getMode(app.mode()).accent
  return (
    <box flexDirection="column" marginBottom={1}>
      <ThinkingCard item={props.item} />
      <Show when={props.item.text.length > 0}>
        <box
          flexDirection="column"
          border
          borderStyle="rounded"
          borderColor={accent()}
          paddingLeft={1}
          paddingRight={1}
        >
          <text fg={accent()}>⬡ friday</text>
          <text fg={theme.text} selectable>
            {props.item.text}
            {props.item.done ? "" : " ▋"}
          </text>
        </box>
      </Show>
    </box>
  )
}

function ErrorBubble(props: { item: Extract<ViewItem, { kind: "error" }> }) {
  return (
    <box
      flexDirection="row"
      gap={1}
      border
      borderStyle="rounded"
      borderColor={theme.error}
      paddingLeft={1}
      paddingRight={1}
      marginBottom={1}
    >
      <text fg={theme.error}>✗</text>
      <text fg={theme.text} selectable>
        {props.item.text}
      </text>
    </box>
  )
}

export function Chat() {
  const app = useApp()
  return (
    <scrollbox flexGrow={1} minHeight={0} stickyScroll stickyStart="bottom" paddingTop={1}>
      <Show when={app.items.length === 0}>
        <box flexDirection="column" alignItems="center" justifyContent="center" paddingTop={2} gap={1}>
          <Logo />
          <text fg={theme.textFaint}>
            Ask Friday anything. Press ? for shortcuts, or /model to connect a provider.
          </text>
        </box>
      </Show>
      <For each={app.items}>
        {(item) => (
          <Switch>
            <Match when={item.kind === "user"}>
              <UserBubble item={item as any} />
            </Match>
            <Match when={item.kind === "assistant"}>
              <AssistantMessage item={item as any} />
            </Match>
            <Match when={item.kind === "tool"}>
              <ToolCard item={item as any} />
            </Match>
            <Match when={item.kind === "error"}>
              <ErrorBubble item={item as any} />
            </Match>
          </Switch>
        )}
      </For>
    </scrollbox>
  )
}
