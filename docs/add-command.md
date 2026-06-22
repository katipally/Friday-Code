# `/add` — steer a running agent without stopping it

`/add` lets you hand Friday new information **while it's working**, without killing the task. Your note
is folded into the conversation at the agent's next step, so it course-corrects in seconds and keeps all
the work it's already done.

## The three ways to give the agent info

| | What it does | Cost | When to use |
|---|---|---|---|
| **Stop** (double-`Esc`) | Aborts the in-flight step and discards its work; agent restarts cold. | Throws away in-progress work | The agent is doing the *wrong thing* and you want it to stop now. |
| **Type while busy** (queue) | Your message waits until the **whole task finishes**, then runs as a new prompt. | Corrects too late | A follow-up task for *after* this one. |
| **`/add`** | Folds your note in at the agent's **next step** — it never stops, never restarts. | Cheap; keeps all work | You forgot something and want it considered *now*, mid-task. |

## Usage

- **`/add <text>`** — inject immediately. The agent does **not** pause; it sees your note on its next
  model call (between tool calls) and adjusts.
  ```
  /add use tabs, not spaces
  /add the API base url is staging.example.com, not prod
  ```
- **`/add`** (no text) — opens a composer modal. If the agent is working it **soft-pauses** at the next
  step boundary and idles while you write. Supports `@file` and `@image.png` mentions and pasted blocks,
  just like the main prompt. Press `⏎` to send (agent resumes with your note) or `Esc` to cancel (agent
  resumes with nothing added).

When the agent is idle, `/add` behaves exactly like a normal prompt.

## How it works under the hood

```
  /add <text> ──► inject ───────────────┐
  /add (bare) ──► pause + composer ──────┤
                                         ▼
   loop step:  …step 4 [running] ──► step 4 finishes
                 ──► your note appended to history ──► step 5 sees it
                 agent NEVER idles (text form). Corrects in seconds.
```

Friday's agent loop re-sends the conversation to the model on every step. `/add` simply appends your note
to that conversation at the **end**, right before the next step. Because it lands at the end, the cached
context prefix is preserved — your note rides on top of already-cached history at ~10% token cost, so
steering is nearly free. It is *not* magic: the note is read on the **next** model call, not mid-token.

## Why it helps

Agents go off-track when they **guess at missing information and then build on the guess** — one bad
assumption at step 2 becomes ten steps of wrong work by step 12. `/add` is grounding-on-demand: the moment
you see it drift, you hand it the missing fact *before* the guess compounds.

> This is about preventing wrong turns, not lowering the model's hallucination rate. You're removing the
> *reason* the agent would guess, early enough that it doesn't cost you a wrong-direction completion.

## Limits

- The note lands at the **next step boundary**. If the agent is mid-way through a single long-running tool
  (e.g. a 6-minute build), your note is applied once that tool returns — it can't interrupt a tool that's
  already executing.
- `/add` targets the focused session.
- To truly halt the agent, use **Stop** (double-`Esc`), not `/add`.
