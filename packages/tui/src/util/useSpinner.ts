import { createSignal, onCleanup, onMount, type Accessor } from "solid-js"

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

/** A braille spinner accessor, animated at ~80ms. */
export function useSpinner(): Accessor<string> {
  const [i, setI] = createSignal(0)
  onMount(() => {
    const t = setInterval(() => setI((v) => (v + 1) % FRAMES.length), 80)
    onCleanup(() => clearInterval(t))
  })
  return () => FRAMES[i()]!
}
