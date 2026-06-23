# Pausing a running agent with /pause

Most of the time an agent goes wrong because it guessed at something you knew,
then built ten steps of work on top of the guess. By the time you read the
output, the wrong turn is already buried. `/pause` is the fix: hand Friday new
information while it is working, without killing the task.

`/pause` soft-interrupts the current generation immediately and opens a composer
where you write what the agent missed. On send, your note is folded into the
conversation and the agent resumes with it in view — so it course-corrects
instead of finishing down the wrong path.

"Pause" here means cut the current generation and redirect. It is not the same
as Stop (double-Esc), which halts the whole task and throws the work away.

> `/nudge` and `/add` are aliases for `/pause` — same behavior.

## The three ways to give the agent information

| Action | What it does | When to use |
|---|---|---|
| Stop (double-Esc) | Aborts the in-flight step and discards its work. The agent stops cold. | You want it to stop now and you're done. |
| Type while busy | Your message waits until the whole task finishes, then runs as a new prompt. | A follow-up task for after this one. |
| `/pause` | Soft-interrupts the current generation, opens a composer; your note folds in and the agent resumes. | You're watching it drift and want to redirect it right now. |

## Usage

`/pause` (or **Shift+Esc**) only does something while the agent is working — if
it's idle there's nothing to pause, and Friday says so. It interrupts the
current generation and opens a composer modal. Any text typed inline after the
command is ignored; the composer is the single entry point, so you can attach
`@file` / `@image.png` mentions and paste blocks before sending, the same as the
main prompt.

```
/pause
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
  /pause -> ...step 4 [generating] -> soft-interrupt -> composer opens
         -> you write a note -> Enter -> note appended to the conversation
         -> agent resumes with the note in view
```

Friday re-sends the conversation to the model on every step, and your note is
appended at the end of that conversation. The cached prefix is preserved, so the
note rides on already-cached history at roughly 10 percent token cost.

## Why it helps

Agents drift when they guess at missing information and then build on the guess.
One bad assumption at step 2 becomes ten steps of wrong work by step 12. `/pause`
is grounding on demand: the moment you see it drift, you hand it the missing
fact before the guess compounds. This is not about lowering the model's
hallucination rate. You are removing the reason the agent would guess, early
enough that it does not cost you a wrong-direction completion.

## Limits

- `/pause` soft-interrupts generation. If the agent is mid-way through a single
  long-running tool (a six-minute build, for example), the tool finishes first
  and your note lands at the next step.
- `/pause` targets the focused session.
- To truly halt the agent, use Stop (double-Esc), not `/pause`.
