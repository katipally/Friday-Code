import { For, Match, Show, Switch } from "solid-js"
import { theme, getMode, type ModeId } from "@friday/shared"
import { useApp, type ViewItem } from "../store.tsx"
import { ThinkingCard } from "./ThinkingCard.tsx"
import { ToolCard } from "./ToolCard.tsx"
import { Markdown } from "./Markdown.tsx"
import { Logo } from "./Logo.tsx"
import { Appear } from "../motion/index.ts"

/** User prompt: ❯ marker + a left accent bar colored by the mode it was sent in, with padding. */
function UserBubble(props: { item: Extract<ViewItem, { kind: "user" }> }) {
  const app = useApp()
  const accent = () => getMode((props.item.mode as ModeId) ?? app.mode()).accent
  return (
    <box flexDirection="row" gap={1} marginBottom={1}>
      <box width={1} backgroundColor={accent()} />
      <text fg={accent()}>❯</text>
      <text fg={theme.text} selectable>
        {props.item.text}
      </text>
    </box>
  )
}

/** Assistant reply: rendered flush on the background with a ⏺ marker; reasoning is a ⎿ branch. */
function AssistantMessage(props: { item: Extract<ViewItem, { kind: "assistant" }> }) {
  const app = useApp()
  const accent = () => getMode(app.mode()).accent
  return (
    <box flexDirection="column" marginBottom={1}>
      <ThinkingCard item={props.item} />
      <Show when={props.item.text.length > 0}>
        <box flexDirection="row" gap={1}>
          <text fg={accent()}>⏺</text>
          <box flexGrow={1} flexDirection="column">
            <Markdown content={props.item.text} />
            <Show when={!props.item.done}>
              <text fg={theme.textFaint}>▋</text>
            </Show>
          </box>
        </box>
      </Show>
    </box>
  )
}

function ErrorBubble(props: { item: Extract<ViewItem, { kind: "error" }> }) {
  return (
    <box flexDirection="row" gap={1} marginBottom={1}>
      <text fg={theme.error}>⏺</text>
      <text fg={theme.error} selectable>
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
          <Appear distance={1} duration={170}>
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
          </Appear>
        )}
      </For>
    </scrollbox>
  )
}
