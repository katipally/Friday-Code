import { createSignal, onCleanup, onMount } from "solid-js"
import { getMode } from "@friday/shared"
import { useApp } from "../store.tsx"
import { lighten } from "../util/colors.ts"

/**
 * The `friday` wordmark in opencode's block-art style (ascii-font `block` = █▀▄ pixels),
 * with a shimmer that pulses the color toward a lighter tint of the current mode accent.
 */
export function Logo() {
  const app = useApp()
  const [t, setT] = createSignal(0)

  onMount(() => {
    const timer = setInterval(() => setT((v) => (v + 1) % 100), 90)
    onCleanup(() => clearInterval(timer))
  })

  const color = () => {
    const accent = getMode(app.mode()).accent
    // smooth 0..1..0 shimmer
    const wave = (Math.sin((t() / 100) * Math.PI * 2) + 1) / 2
    return lighten(accent, wave * 0.45)
  }

  return <ascii_font text="friday" font="block" color={color()} />
}
