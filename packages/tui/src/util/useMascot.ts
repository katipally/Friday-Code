import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js"
import { MASCOT, type MascotState } from "@friday/shared"

/** Returns an accessor to the current mascot frame string, animated for the given state. */
export function useMascotFrame(state: Accessor<MascotState>): Accessor<string> {
  const [frame, setFrame] = createSignal(0)

  createEffect(() => {
    const anim = MASCOT[state()]
    setFrame(0)
    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % anim.frames.length)
    }, anim.interval)
    onCleanup(() => clearInterval(timer))
  })

  return () => {
    const anim = MASCOT[state()]
    return anim.frames[frame() % anim.frames.length] ?? anim.frames[0]!
  }
}
