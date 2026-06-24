# Steering a running agent with /steer

Most of the time an agent goes wrong because it guessed at something you knew,
then built ten steps of work on top of the guess. By the time you read the
output, the wrong turn is already buried. `/steer` is the fix: hand Friday new
information while it is working, without killing the task.

`/steer` soft-interrupts the current generation immediately and opens a composer
where you write what the agent missed, or where you redirect it. On send, your
note is folded into the conversation and the agent resumes with it in view — so
it course-corrects instead of finishing down the wrong path.

"Steer" here means cut the current generation and redirect. It is not the same
as Stop (double-Esc), which halts the whole task and throws the work away.

## The three ways to give the agent information

| Action | What it does | When to use |
|---|---|---|
| Stop (double-Esc) | Aborts the in-flight step and discards its work. The agent stops cold. | You want it to stop now and you're done. |
| Type while busy | Your message waits until the whole task finishes, then runs as a new prompt. | A follow-up task for after this one. |
| `/steer` | Soft-interrupts the current generation, opens a composer; your note folds in and the agent resumes. | You're watching it drift and want to redirect it right now. |

## Usage

`/steer` (or **Ctrl+Space**) only does something while the agent is working — if
it's idle there's nothing to steer, and Friday says so. It interrupts the
current generation and opens a composer modal. Any text typed inline after the
command is ignored; the composer is the single entry point, so you can attach
`@file` / `@image.png` mentions and paste blocks before sending, the same as the
main prompt.

> Key: **Ctrl+Space** everywhere. On kitty-protocol terminals **Cmd+Enter** also
> works; on terminals without it, **Ctrl+P** is the reliable fallback.

```
/steer
→ composer opens: "we are keeping the old auth API, do not rewrite it"
→ Enter → note folds in, agent resumes
```

In the composer:

- **Enter** sends your note. It is folded into the conversation and the agent
  picks up from where it paused, now with your context in view.
- **Esc** releases the pause and resumes the agent without adding anything.
- Sending an empty note also just resumes.

## How it works

```
  /steer -> ...step 4 [generating] -> soft-interrupt -> composer opens
         -> you write a note -> Enter -> note appended to the conversation
         -> agent resumes with the note in view
```

Friday re-sends the conversation to the model on every step, and your note is
appended at the end of that conversation. The cached prefix is preserved, so the
note rides on already-cached history at roughly 10 percent token cost.

## What it actually saves (honest version)

`/steer` is not a magic token saver and it does not lower the model's
hallucination rate — the model is stateless and re-reads the context on the
corrected step either way. Compared with Stop + a fresh prompt, what it really
buys you is:

- **In-flight tool work is kept** — a running command or read isn't thrown away.
- **The model amends instead of restarting** — your note reads as "adjust this,"
  which gives better corrections than a cold re-prompt.
- **No dead-state friction** — the agent never fully stops; it just redirects.

The token win, when there is one, comes from **catching the wrong direction
early** so you don't pay for a wrong-direction completion — not from the
mechanism itself.

## Why it helps

Agents drift when they guess at missing information and then build on the guess.
One bad assumption at step 2 becomes ten steps of wrong work by step 12. `/steer`
is grounding on demand: the moment you see it drift, you hand it the missing
fact before the guess compounds.

## Limits

- `/steer` soft-interrupts generation. If the agent is mid-way through a single
  long-running tool (a six-minute build, for example), the tool finishes first
  and your note lands at the next step.
- `/steer` targets the focused session.
- To truly halt the agent, use Stop (double-Esc), not `/steer`.
