# Security Policy

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue.

Use [GitHub Security Advisories](https://github.com/katipally/friday-code/security/advisories/new)
("Report a vulnerability"), or email **katipally.yashwanth.reddy@gmail.com**.

Include reproduction steps and the version (`friday --version`) where possible. You'll get an
acknowledgement within a few days. Coordinated disclosure is appreciated: please give a reasonable
window to ship a fix before any public discussion.

## Supported versions

The latest published `2.x` release receives security fixes.

## Security model

Friday is an AI coding agent: by design it can **read and write files** and **run shell commands**
in your working directory. Treat it like a powerful local tool. Key safeguards:

- **Permission modes** — `plan` (read-only), `default` (asks before edits/commands), `accept-edit`,
  and `yolo` (auto-approve). Cycle with **Shift+Tab**. Mode gates every tool call.
- **Bash safety** — risky-command detection (e.g. `rm -rf`, `curl | sh`, `sudo`, `git push`, fork
  bombs) warns/blocks, plus per-project `allow`/`deny` lists. Commands run via `Bun.spawn` without a
  shell (`shell: true` is never used).
- **Path containment** — file tools resolve relative paths against the session working directory.
- **Credentials** — provider API keys are stored in `~/.friday/auth.json` with `0600` permissions,
  or read from environment variables. Keys are never written to the repo or logs.
- **Frozen binaries** — the compiled binary is built with `--no-compile-autoload-bunfig`, so it does
  **not** read or execute `preload` scripts from a working-directory `bunfig.toml`.

## Your responsibility

- Don't run Friday in `yolo` mode on untrusted code or prompts.
- Review proposed edits and commands, especially when a prompt or repo content is untrusted
  (prompt-injection via file contents or tool output is a real risk for any agent).
- Keep your provider API keys secret; rotate them if exposed.
