/**
 * Shared UI vocabulary. Every region is built from these so spacing, borders, titles and
 * selection look the same everywhere.
 *
 * Design rules baked in here:
 *  - Everything is borderless, including modals (<Overlay>): separation is surface fills + the
 *    dimmed scrim + spacing. The only border left in the app is the composer's focus ring.
 *  - Hierarchy comes from background-fill steps + spacing + dim UPPERCASE labels, not boxes.
 *  - Brand amber is IDENTITY only (titles, wordmark). It is NOT used for selection/hover.
 *  - Selection is a single full-width NEUTRAL grey fill band (theme.bgSelected) with bright text —
 *    distinct from brand and from hover (bgHover). See <Row> / bandBg. A caller may pass a semantic
 *    color (warning/error) to bandBg for a meaningful colored band (permission/yolo gates).
 */
import { theme } from "@friday/shared"
import { type JSX, Show } from "solid-js"
import { shimmerAccent } from "../motion/index.ts"

/** One spacing scale so padding/gap stop drifting between components. */
export const PAD = 1
export const GAP = 1
export const SECTION_GAP = 2

/** Bold title. Chrome titles glow brand amber; chat passes the mode accent via `color`. */
export function Title(props: { text: string; color?: string }) {
  return (
    <text fg={props.color ?? shimmerAccent(theme.brand)}>
      <strong>{props.text}</strong>
    </text>
  )
}

/** UPPERCASE dim label for sections: FILES, TODOS, PLAN. */
export function SectionLabel(props: { text: string }) {
  return <text fg={theme.textFaint}>{props.text.toUpperCase()}</text>
}

/** Dim metadata / hint line: `3 files · $0.04`, timestamps, key hints. */
export function Meta(props: { text: string; color?: string }) {
  return <text fg={props.color ?? theme.textFaint}>{props.text}</text>
}

/** Borderless region with the panel surface + standard padding and an optional UPPERCASE label. */
export function Panel(props: { title?: string; grow?: boolean; children: JSX.Element }) {
  return (
    <box
      flexDirection="column"
      flexGrow={props.grow ? 1 : 0}
      backgroundColor={theme.bgPanel}
      paddingLeft={PAD}
      paddingRight={PAD}
      gap={GAP}
    >
      <Show when={props.title}>
        <SectionLabel text={props.title!} />
      </Show>
      {props.children}
    </box>
  )
}

/**
 * The modal/overlay body (drop it inside <Scrim>). Borderless — separation comes from the elevated
 * surface floating on the dimmed scrim backdrop + generous padding. Brand-amber UPPERCASE title.
 */
export function Overlay(props: { title?: string; hint?: string; width?: number; children: JSX.Element }) {
  return (
    <box
      flexDirection="column"
      width={props.width}
      backgroundColor={theme.bgElevated}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      gap={GAP}
    >
      <Show when={props.title}>
        <box flexDirection="row" gap={1} alignItems="center">
          <Title text={props.title!.toUpperCase()} />
          <Show when={props.hint}>
            <text fg={theme.textFaint}>· {props.hint}</text>
          </Show>
        </box>
      </Show>
      {props.children}
    </box>
  )
}

/**
 * Selection-band background. The single selection affordance app-wide: a solid fill across the row
 * when selected, transparent otherwise. Defaults to the neutral selection grey (theme.bgSelected) —
 * NEVER brand, so selection and brand identity stay visually distinct. Pass a semantic color
 * (warning/error) only for a meaningful colored band (permission/yolo gates).
 * Use this for custom rows that <Row> can't express (icons, inline buttons).
 */
export function bandBg(selected: boolean, accent?: string): string {
  return selected ? (accent ?? theme.bgSelected) : "transparent"
}

/**
 * Standard label[+hint] list/menu row with the full-fill selection band and inverse text when
 * selected. `accent` overrides the band color (brand by default; chat passes the mode accent).
 */
export function Row(props: {
  label: string
  hint?: string
  selected?: boolean
  accent?: string
  /** fixed label column width so hints line up */
  labelWidth?: number
  onSelect?: () => void
  onActivate?: () => void
}) {
  const sel = () => !!props.selected
  const labelFg = () => (sel() ? theme.textOnAccent : theme.text)
  const hintFg = () => (sel() ? theme.textOnAccent : theme.textFaint)
  return (
    <box
      flexDirection="row"
      gap={1}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={bandBg(sel(), props.accent)}
      onMouseOver={() => props.onSelect?.()}
      onMouseDown={() => props.onActivate?.()}
    >
      <Show
        when={props.labelWidth}
        fallback={
          <text fg={labelFg()}>{sel() ? <strong>{props.label}</strong> : props.label}</text>
        }
      >
        <box width={props.labelWidth}>
          <text fg={labelFg()}>{sel() ? <strong>{props.label}</strong> : props.label}</text>
        </box>
      </Show>
      <Show when={props.hint}>
        <text fg={hintFg()}>{props.hint}</text>
      </Show>
    </box>
  )
}
