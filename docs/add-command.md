# `/add` — steer a running agent without stopping it

`/add` lets you hand Friday new information **while it's working**, without killing the task. By default
it **pauses the current generation** and folds your note in immediately so it course-corrects right
away; use `/add!` if you'd rather let the current step finish first.

(“Pause” here means cut the current generation and redirect — distinct from **Stop** (double-`Esc`), which
halts the whole task.)

## The ways to give the agent info

| | What it does | Cost | When to use |
|---|---|---|---|
| **Stop** (double-`Esc`) | Aborts the in-flight step and discards its work; agent restarts cold. | Throws away in-progress work | The agent is doing the *wrong thing* and you want it to stop now. |
| **Type while busy** (queue) | Your message waits until the **whole task finishes**, then runs as a new prompt. | Corrects too late | A follow-up task for *after* this one. |
| **`/add`** | **Pauses the current generation immediately**, keeps the partial reply, folds your note in, regenerates the step. | Wastes only the partial output already streamed (~cents) | You're *watching* it go wrong and want to cut it off right now (the default). |
| **`/add!`** | Lets the current step finish, then folds your note in at the agent's **next step** — never stops, never restarts. | Cheap; keeps all work | You forgot something but the current step is fine to finish. |

## Usage

- **`/add <text>`** — **pause now** (the default). Cuts the model off mid-generation, keeps whatever
  it had written so far as context, folds your note in, and regenerates the step. Use it when you can see
  a wrong answer streaming and don't want to wait for it to finish.
  ```
  /add stop — we're keeping the old auth API, don't rewrite it
  ```
- **`/add! <text>`** — **fold in at the next step**. Lets the current step finish, then adds your note so
  the agent sees it on its next model call (between tool calls). Zero waste.
  ```
  /add! use tabs, not spaces
  /add! the API base url is staging.example.com, not prod
  ```
- **`/add`** (no text) — opens a composer modal. If the agent is working it **soft-pauses** at the next
  step boundary and idles while you write. Supports `@file` and `@image.png` mentions and pasted blocks,
  just like the main prompt. Press `⏎` to **pause now**, click **＋ next step** to fold in later, or
  `Esc` to cancel (agent resumes with nothing added).

When the agent is idle, `/add` and `/add!` behave exactly like a normal prompt.

> **`/add` vs `/add!`** — `/add` cuts the step off *now* (you pay for the partial output it already
> streamed, usually a few cents); `/add!` waits for the current step to finish (zero waste) then folds in
> your note. Note: `/add` pauses **generation** only — if a tool (a build, a command) is already
> running it finishes first, and the note then lands at the next step (same as `/add!`).

## How it works under the hood

```
  /add  <text> ─► pause:     …step 4 [streaming junk] ─►✂ cut ─► keep partial
                    ─► note appended ─► step 4 regenerates with both in view
  /add! <text> ─► next step:  …step 4 [running] ─► step 4 finishes
                    ─► note appended ─► step 5 sees it (zero waste)
```

Friday's agent loop re-sends the conversation to the model on every step, and your note is appended at the
**end** of that conversation either way — so the cached prefix is preserved and the note rides on
already-cached history at ~10% token cost. The only difference: `/add` aborts the in-flight generation
first (keeping the partial reply as context) so the note lands *this* step; `/add!` waits for the step to
finish so the note lands at the *next* one. Pausing wastes only the partial output already streamed
(~cents); it pauses **generation**, never a tool that's already running.

## Why it helps

Agents go off-track when they **guess at missing information and then build on the guess** — one bad
assumption at step 2 becomes ten steps of wrong work by step 12. `/add` is grounding-on-demand: the moment
you see it drift, you hand it the missing fact *before* the guess compounds.

> This is about preventing wrong turns, not lowering the model's hallucination rate. You're removing the
> *reason* the agent would guess, early enough that it doesn't cost you a wrong-direction completion.

## Limits

- `/add` pauses **generation** only. If the agent is mid-way through a single long-running tool (e.g. a
  6-minute build), the tool finishes first and your note lands at the next step (same as `/add!`).
- `/add` and `/add!` target the focused session.
- To truly halt the agent, use **Stop** (double-`Esc`), not `/add`.
