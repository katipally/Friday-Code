/**
 * Shared UI vocabulary. Every region is built from these so spacing, borders, titles and
 * selection look the same everywhere.
 *
 * Design rules baked in here:
 *  - Regions/lists/menus are borderless, including modals (<Overlay>): separation is surface fills +
 *    the dimmed scrim + spacing. Hierarchy comes from background-fill steps + spacing + dim UPPERCASE
 *    labels, not boxes.
 *  - The ONLY borders in the app are deliberate affordances: (a) the composer's focus ring and
 *    (b) action <Pill>s — a rounded outline so a button reads as a button. Lists/rows/selection
 *    bands stay borderless so the two cues never compete.
 *  - Brand amber is IDENTITY only (titles, wordmark). It is NOT used for selection/hover.
 *  - Selection is a single full-width NEUTRAL grey fill band (theme.bgSelected) with bright text —
 *    distinct from brand and from hover (bgHover). See <Row> / bandBg. A caller may pass a semantic
 *    color (warning/error) to bandBg for a meaningful colored band (permission/yolo gates).
 */
import { theme } from "@friday/shared"
import { type JSX, Show } from "solid-js"
import { shimmerAccent, useHover } from "../motion/index.ts"

/** One spacing scale so padding/gap stop drifting between components. */
export const PAD = 1
export const GAP = 1

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
        fallback={<text fg={labelFg()}>{sel() ? <strong>{props.label}</strong> : props.label}</text>}
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

/**
 * Action button. The one affordance allowed to wear a border: a rounded outline that brightens on
 * hover / keyboard-focus, so a button reads as a button (vs. flat informational text). Width fits the
 * label — no fixed width — so it adapts to its content. `accent` carries meaning (success/error/info/
 * brand): the outline + label wear it, and the whole outline brightens + the label bolds when active.
 * Deliberately NO background fill — a filled cell can't render rounded corners, so a fill would read
 * as a square block bigger than the outline; brightening the outline keeps the exact pill shape.
 *
 * Use for real actions (connect, open, enable, run). Keep lists/menus on <Row> (borderless).
 */
export function Pill(props: {
  label: string
  onClick?: () => void
  /** semantic action color — the outline + label wear it; it brightens when active. Defaults to brand. */
  accent?: string
  /** keyboard-focused → brightened (independent of mouse hover). */
  selected?: boolean
  /** dim, non-interactive (e.g. an unsupported action). */
  disabled?: boolean
  /** dim trailing hint drawn after the label, inside the pill. */
  hint?: string
  /** stretch to fill the row. */
  grow?: boolean
}) {
  const h = useHover({ base: "transparent", hover: "transparent" })
  const accent = () => props.accent ?? theme.brand
  const active = () => !props.disabled && (props.selected || h.hovered())
  // The outline lives one shade down from the accent at rest, then snaps to the full accent when
  // active — a clear "lift" with no fill, so corners stay rounded and nothing spills past the shape.
  const edge = () => (props.disabled ? theme.borderMuted : active() ? accent() : theme.border)
  const fg = () => (props.disabled ? theme.textFaint : accent())
  return (
    <box
      flexDirection="row"
      flexGrow={props.grow ? 1 : 0}
      flexShrink={0}
      justifyContent="center"
      gap={1}
      paddingLeft={1}
      paddingRight={1}
      border
      borderStyle="rounded"
      borderColor={edge()}
      onMouseOver={props.disabled ? undefined : h.onMouseOver}
      onMouseOut={props.disabled ? undefined : h.onMouseOut}
      onMouseDown={props.disabled ? undefined : () => props.onClick?.()}
    >
      <text fg={fg()}>{active() ? <strong>{props.label}</strong> : props.label}</text>
      <Show when={props.hint}>
        <text fg={theme.textFaint}>{props.hint}</text>
      </Show>
    </box>
  )
}

/**
 * Clickable hint chip. The hint-line counterpart to <Pill>: a one-row, borderless, soft affordance
 * for the key reminders in footers ("⏎ run", "esc close", "↑↓ move"). It brightens on hover and fires
 * onClick, so the keyboard hints double as mouse targets. Omit onClick for a purely informational
 * token (it then renders flat, no hover). `accent` tints the label on hover (defaults to neutral).
 */
export function HintChip(props: { label: string; onClick?: () => void; accent?: string }) {
  const interactive = () => !!props.onClick
  const h = useHover({ base: "transparent", hover: theme.bgHover })
  const fg = () => (h.hovered() ? (props.accent ?? theme.text) : theme.textFaint)
  return (
    <box
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={interactive() ? h.bg() : "transparent"}
      onMouseOver={interactive() ? h.onMouseOver : undefined}
      onMouseOut={interactive() ? h.onMouseOut : undefined}
      onMouseDown={props.onClick}
    >
      <text fg={interactive() ? fg() : theme.textFaint}>{props.label}</text>
    </box>
  )
}

/**
 * Segmented control — a row of borderless tabs with a single full-fill band on the active one.
 * (Tabs are navigation, not actions, so they stay borderless like <Row>; <Pill> is for actions.)
 */
export function Tabs(props: {
  items: { label: string; key: string }[]
  active: string
  accent?: string
  onSelect?: (key: string) => void
}) {
  return (
    <box flexDirection="row" gap={1}>
      {props.items.map((it) => {
        const sel = () => it.key === props.active
        return (
          <box
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={bandBg(sel(), props.accent)}
            onMouseDown={() => props.onSelect?.(it.key)}
          >
            <text fg={sel() ? theme.textOnAccent : theme.textMuted}>
              {sel() ? <strong>{it.label}</strong> : it.label}
            </text>
          </box>
        )
      })}
    </box>
  )
}
