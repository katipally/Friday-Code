#!/usr/bin/env node
// Thin launcher: resolve the prebuilt, self-contained Friday binary for this platform
// (installed as an optional dependency by npm) and exec it — forwarding args, stdio,
// exit code, and termination signals. The binaries embed the Bun runtime + native
// renderer, so no Bun/Node toolchain is needed at runtime.
import { spawn } from "node:child_process"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { platform, arch } = process

const PKGS = {
  "darwin-arm64": "friday-code-darwin-arm64",
  "darwin-x64": "friday-code-darwin-x64",
  "linux-x64": "friday-code-linux-x64",
  "linux-arm64": "friday-code-linux-arm64",
  "win32-x64": "friday-code-windows-x64",
}

const key = `${platform}-${arch}`
const pkg = PKGS[key]
if (!pkg) {
  console.error(`friday: no prebuilt binary for ${key}. Supported: ${Object.keys(PKGS).join(", ")}.`)
  console.error("Build from source (https://github.com/katipally/friday-code) or open an issue for your platform.")
  process.exit(1)
}

const exe = platform === "win32" ? "friday.exe" : "friday"
let binPath
try {
  binPath = require.resolve(`${pkg}/bin/${exe}`)
} catch {
  console.error(`friday: the platform package "${pkg}" is missing.`)
  console.error("Reinstall with `npm install -g friday-code`, or download a binary from")
  console.error("https://github.com/katipally/friday-code/releases.")
  process.exit(1)
}

const child = spawn(binPath, process.argv.slice(2), { stdio: "inherit" })
child.on("error", (err) => {
  console.error(`friday: failed to launch: ${err.message}`)
  process.exit(1)
})
// Forward termination signals so Ctrl-C etc. reach the real process.
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => child.kill(sig))
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
