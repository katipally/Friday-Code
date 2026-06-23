# Steering a running agent with /add and /add!

Most of the time an agent goes wrong because it guessed at something you knew,
then built ten steps of work on top of the guess. By the time you read the
output, the wrong turn is already buried. `/add` is the fix: hand Friday new
information while it is working, without killing the task.

By default `/add` pauses the current generation and folds your note in right
away, so the agent course-corrects on this step. Use `/add!` instead when the
current step is fine to finish and you only want the note picked up next time
the model runs.

"Pause" here means cut the current generation and redirect. It is not the same
as Stop (double-Esc), which halts the whole task and throws the work away.

## The four ways to give the agent information

| Action | What it does | Cost | When to use |
|---|---|---|---|
| Stop (double-Esc) | Aborts the in-flight step and discards its work. The agent stops cold. | Throws away in-progress work | The agent is doing the wrong thing and you want it to stop now. |
| Type while busy | Your message waits until the whole task finishes, then runs as a new prompt. | Corrects too late | A follow-up task for after this one. |
| `/add` | Pauses the current generation immediately, keeps the partial reply, folds your note in, and regenerates the step. | Wastes only the partial output already streamed (about cents) | You are watching it go wrong and want to cut it off right now. This is the default. |
| `/add!` | Lets the current step finish, then folds your note in at the next step. Never stops, never restarts. | Cheap, keeps all work | You forgot something but the current step is fine to finish. |

## Usage

`/add <text>` pauses now (the default). It cuts the model off mid-generation,
keeps whatever it had written so far as context, folds your note in, and
regenerates the step. Reach for it when you can see a wrong answer streaming and
do not want to wait for it to finish.

```
/add stop, we are keeping the old auth API, do not rewrite it
```

`/add! <text>` folds in at the next step. It lets the current step finish, then
adds your note so the agent sees it on its next model call (between tool calls).
Zero waste.

```
/add! use tabs, not spaces
/add! the API base url is staging.example.com, not prod
```

`/add` with no text opens a composer modal. If the agent is working, it
soft-pauses at the next step boundary and idles while you write. The composer
supports `@file` and `@image.png` mentions and pasted blocks, the same as the
main prompt. Press Enter to pause now (like `/add`), click "+ next step" to fold
in later (like `/add!`), or Esc to cancel and let the agent resume with nothing
added.

When the agent is idle, `/add` and `/add!` behave exactly like a normal prompt.

## How it works

```
  /add  <text> -> pause:     ...step 4 [streaming junk] -> cut -> keep partial
                   -> note appended -> step 4 regenerates with both in view

  /add! <text> -> next step: ...step 4 [running] -> step 4 finishes
                   -> note appended -> step 5 sees it (zero waste)
```

Friday re-sends the conversation to the model on every step, and your note is
appended at the end of that conversation either way. The cached prefix is
preserved, so the note rides on already-cached history at roughly 10 percent
token cost. The only difference is timing. `/add` aborts the in-flight
generation first, keeping the partial reply as context, so the note lands on
this step. `/add!` waits for the step to finish, so the note lands on the next
one.

## Why it helps

Agents drift when they guess at missing information and then build on the guess.
One bad assumption at step 2 becomes ten steps of wrong work by step 12. `/add`
is grounding on demand: the moment you see it drift, you hand it the missing
fact before the guess compounds. This is not about lowering the model's
hallucination rate. You are removing the reason the agent would guess, early
enough that it does not cost you a wrong-direction completion.

## Limits

- `/add` pauses generation only. If the agent is mid-way through a single
  long-running tool (a six-minute build, for example), the tool finishes first
  and your note lands at the next step, the same as `/add!`.
- `/add` and `/add!` target the focused session.
- To truly halt the agent, use Stop (double-Esc), not `/add`.
