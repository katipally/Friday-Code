# Integrations

Browser control, desktop control, and voice input are off by default. Turn them
on when you need them. LSP grounding and headless mode round out the surface.

## Browser

Run `/browser` (alias `/chrome`) to launch a browser and activate the
`browser_*` tools for the session. Friday drives it over the Chrome DevTools
Protocol: navigate, click, fill, evaluate scripts, take screenshots, read the
console. Run `/browser close` to stop it. You need a Chromium-based browser
installed (Chrome, Brave, or Edge). Browser actions are gated by the current
mode like any other tool.

## Computer use

Run `/computer` to open the desktop-control panel. From there you install or
remove support, check what your platform allows, and see the permission guidance.
Once installed, the `computer_*` tools control the mouse, keyboard, and
screenshots. This is the most powerful and the most invasive integration, so it
stays gated and opt-in.

## Voice

Press Ctrl+R (or run `/mic`) to talk to Friday. Transcription runs on-device with
Whisper through Hugging Face Transformers, so audio never leaves your machine.
Pick the input device and watch the live transcript as you speak.

## LSP grounding

When a language server is installed, Friday uses it to ground the agent in real
type information instead of guesses. Supported out of the box:
typescript-language-server, pyright, gopls, and rust-analyzer. They are
auto-detected and skipped if absent. The matching tools are `lsp_hover`,
`lsp_definition`, and `lsp_symbols`.

## Headless and CI

`friday run "<prompt>"` runs one turn, auto-approves tools, prints the result,
and exits. Add `--json` to emit `{ "text": ... }` for scripting. Combine with
`-c` to continue the most recent session or `-s <id>` to resume a specific one.
This is the mode to wrap in a GitHub Action or a shell pipeline.

```bash
friday run "summarize the changes in this branch"
friday run "list the failing tests" --json
```
