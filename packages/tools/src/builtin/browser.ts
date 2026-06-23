import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { obj, type Tool } from "../tool.ts"

/**
 * Browser automation by driving the user's ALREADY-INSTALLED browser over the Chrome DevTools
 * Protocol — no bundled Chromium, no heavyweight dependency. We launch their Chrome/Brave/Edge with
 * `--remote-debugging-port` on a dedicated friday profile and talk raw CDP over a WebSocket (Bun has
 * both `fetch` and `WebSocket` built in).
 *
 * Snapshot-first: `browser_snapshot` returns the interactive elements as text with stable refs, so
 * the agent can navigate/click/type without needing a vision model. Screenshots are available for
 * the cases where pixels matter.
 *
 * ponytail: one browser session per friday process (module singleton); a dedicated profile rather
 * than the user's main one (you can't reliably attach CDP to a running default Chrome, and enabling
 * debugging on the real profile is a security risk). Point browser.userDataDir at your own profile
 * (closed first) if you want your logged-in sessions.
 */

const BROWSER = "browser" as const

// ---- CDP client ----------------------------------------------------------

type Pending = { resolve: (v: any) => void; reject: (e: any) => void }

class BrowserSession {
  private proc?: ReturnType<typeof Bun.spawn>
  private ws?: WebSocket
  private nextId = 1
  private pending = new Map<number, Pending>()
  private consoleBuf: string[] = []
  port = 0

  get connected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN
  }

  async start(binary?: string, userDataDir?: string, port = 9333): Promise<void> {
    if (this.connected) return
    const bin = binary || findBrowser()
    if (!bin) throw new Error("no Chrome/Brave/Edge/Chromium found — install one or set browser.binary in config")
    const profile = userDataDir || path.join(os.homedir(), ".friday", "chrome-profile")
    fs.mkdirSync(profile, { recursive: true })
    this.port = port
    this.proc = Bun.spawn(
      [
        bin,
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profile}`,
        "--no-first-run",
        "--no-default-browser-check",
        "about:blank",
      ],
      { stdout: "ignore", stderr: "ignore" },
    )
    const wsUrl = await this.discover(port)
    await this.connect(wsUrl)
    await this.send("Page.enable", {})
    await this.send("Runtime.enable", {})
    await this.send("Log.enable", {})
  }

  /** Poll the CDP HTTP endpoint until a page target's websocket URL is available. */
  private async discover(port: number): Promise<string> {
    for (let i = 0; i < 50; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json`)
        const targets = (await res.json()) as { type: string; webSocketDebuggerUrl?: string; url?: string }[]
        const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl)
        if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
      } catch {
        /* not up yet */
      }
      await Bun.sleep(100)
    }
    throw new Error(`browser did not expose a debugging endpoint on :${port}`)
  }

  private connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      this.ws = ws
      ws.addEventListener("open", () => resolve())
      ws.addEventListener("error", () => reject(new Error("CDP websocket error")))
      ws.addEventListener("message", (ev) => this.onMessage(String(ev.data)))
      setTimeout(() => reject(new Error("CDP connect timeout")), 5000)
    })
  }

  private onMessage(raw: string): void {
    let msg: any
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (msg.id && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!
      this.pending.delete(msg.id)
      if (msg.error) p.reject(new Error(msg.error.message ?? "CDP error"))
      else p.resolve(msg.result)
      return
    }
    // events
    if (msg.method === "Runtime.consoleAPICalled") {
      const args = (msg.params?.args ?? []).map((a: any) => a.value ?? a.description ?? "").join(" ")
      this.consoleBuf.push(`[${msg.params?.type ?? "log"}] ${args}`)
    } else if (msg.method === "Log.entryAdded") {
      const e = msg.params?.entry
      if (e) this.consoleBuf.push(`[${e.level}] ${e.text}`)
    }
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error("browser not connected"))
    const id = this.nextId++
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`CDP ${method} timed out`))
      }, 30000)
    })
  }

  async navigate(url: string): Promise<string> {
    await this.send("Page.navigate", { url })
    await Bun.sleep(800) // ponytail: fixed settle instead of wiring Page.loadEventFired; bump if SPAs need it
    return `navigated to ${url}`
  }

  /** Tag interactive elements with stable refs and return them as text. */
  async snapshot(): Promise<string> {
    const expr = `(() => {
      const sel = 'a,button,input,textarea,select,[role=button],[role=link],[onclick]';
      const els = [...document.querySelectorAll(sel)].filter(e => e.offsetParent !== null);
      const out = [];
      els.slice(0, 200).forEach((e, i) => {
        e.setAttribute('data-friday-ref', String(i));
        const name = (e.getAttribute('aria-label') || e.value || e.placeholder || e.innerText || e.alt || '').trim().slice(0, 80);
        out.push({ ref: i, tag: e.tagName.toLowerCase(), type: e.type || '', name });
      });
      return JSON.stringify({ title: document.title, url: location.href, els: out });
    })()`
    const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true })
    const data = r?.result?.value ? JSON.parse(r.result.value) : { els: [] }
    const lines = data.els.map((e: any) => `[${e.ref}] <${e.tag}${e.type ? ` ${e.type}` : ""}> ${e.name}`)
    return `# ${data.title}\n${data.url}\n\n${lines.join("\n") || "(no interactive elements found)"}`
  }

  private refSel(ref: string | number): string {
    return /^\d+$/.test(String(ref)) ? `[data-friday-ref="${ref}"]` : String(ref)
  }

  async click(ref: string | number): Promise<string> {
    const sel = this.refSel(ref)
    const r = await this.send("Runtime.evaluate", {
      expression: `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'not found'; el.click(); return 'clicked'; })()`,
      returnByValue: true,
    })
    await Bun.sleep(300)
    return `${r?.result?.value}: ${sel}`
  }

  async type(ref: string | number, text: string): Promise<string> {
    const sel = this.refSel(ref)
    const r = await this.send("Runtime.evaluate", {
      expression: `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'not found'; el.focus(); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return 'typed'; })()`,
      returnByValue: true,
    })
    return `${r?.result?.value} into ${sel}`
  }

  async evaluate(expression: string): Promise<string> {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true })
    const v = r?.result?.value
    return v === undefined ? "(undefined)" : typeof v === "string" ? v : JSON.stringify(v)
  }

  async screenshot(outPath: string): Promise<string> {
    const r = await this.send("Page.captureScreenshot", { format: "png" })
    if (!r?.data) throw new Error("no screenshot data")
    fs.writeFileSync(outPath, Buffer.from(r.data, "base64"))
    return outPath
  }

  drainConsole(): string {
    const out = this.consoleBuf.join("\n")
    this.consoleBuf = []
    return out || "(no console output)"
  }

  close(): void {
    try {
      this.ws?.close()
    } catch {}
    try {
      this.proc?.kill()
    } catch {}
    this.ws = undefined
    this.proc = undefined
  }
}

let session: BrowserSession | undefined
function active(): BrowserSession {
  if (!session) session = new BrowserSession()
  return session
}

/** Find an installed Chromium-family browser binary. */
export function findBrowser(): string | undefined {
  if (process.platform === "darwin") {
    const apps = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ]
    return apps.find((p) => fs.existsSync(p))
  }
  for (const bin of ["google-chrome", "chromium", "chromium-browser", "brave-browser", "microsoft-edge"]) {
    const found = Bun.which(bin)
    if (found) return found
  }
  if (process.platform === "win32") {
    const wins = [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    ]
    return wins.find((p) => fs.existsSync(p))
  }
  return undefined
}

// ---- tools ----------------------------------------------------------------

export const BROWSER_NAVIGATE = "browser_navigate"
export const BROWSER_SNAPSHOT = "browser_snapshot"
export const BROWSER_CLICK = "browser_click"
export const BROWSER_TYPE = "browser_type"
export const BROWSER_EVAL = "browser_eval"
export const BROWSER_SCREENSHOT = "browser_screenshot"
export const BROWSER_CONSOLE = "browser_console"
export const BROWSER_CLOSE = "browser_close"
export const BROWSER_TOOLS = new Set([
  BROWSER_NAVIGATE,
  BROWSER_SNAPSHOT,
  BROWSER_CLICK,
  BROWSER_TYPE,
  BROWSER_EVAL,
  BROWSER_SCREENSHOT,
  BROWSER_CONSOLE,
  BROWSER_CLOSE,
])

const navigateTool: Tool = {
  name: BROWSER_NAVIGATE,
  description:
    "Open a URL in the user's real browser (launches it on first use). Then use browser_snapshot to see the page's interactive elements. Best for inspecting/driving local dev servers and web apps.",
  permission: BROWSER,
  deferred: true,
  parameters: obj({ url: { type: "string", description: "the URL to open" } }, ["url"]),
  async execute(input: any) {
    await active().start()
    return { output: await active().navigate(String(input.url)), title: `navigate ${input.url}` }
  },
}

const snapshotTool: Tool = {
  name: BROWSER_SNAPSHOT,
  description:
    "Return the current page's title, URL, and a numbered list of interactive elements ([ref] <tag> name). Use the refs with browser_click / browser_type. This is the cheap, no-vision way to understand a page.",
  permission: BROWSER,
  deferred: true,
  parameters: obj({}),
  async execute() {
    return { output: await active().snapshot(), title: "snapshot" }
  },
}

const clickTool: Tool = {
  name: BROWSER_CLICK,
  description: "Click an element by its snapshot ref number (or a CSS selector).",
  permission: BROWSER,
  deferred: true,
  parameters: obj({ ref: { type: "string", description: "ref number from browser_snapshot, or a CSS selector" } }, [
    "ref",
  ]),
  async execute(input: any) {
    return { output: await active().click(input.ref), title: `click ${input.ref}` }
  },
}

const typeTool: Tool = {
  name: BROWSER_TYPE,
  description: "Type text into an input/textarea by its snapshot ref number (or a CSS selector).",
  permission: BROWSER,
  deferred: true,
  parameters: obj(
    {
      ref: { type: "string", description: "ref number from browser_snapshot, or a CSS selector" },
      text: { type: "string", description: "text to type" },
    },
    ["ref", "text"],
  ),
  async execute(input: any) {
    return { output: await active().type(input.ref, String(input.text)), title: `type ${input.ref}` }
  },
}

const evalTool: Tool = {
  name: BROWSER_EVAL,
  description: "Evaluate a JavaScript expression in the page and return its value (JSON-serialized).",
  permission: BROWSER,
  deferred: true,
  parameters: obj({ expression: { type: "string", description: "JS expression to evaluate in the page" } }, [
    "expression",
  ]),
  async execute(input: any) {
    return { output: await active().evaluate(String(input.expression)), title: "eval" }
  },
}

const screenshotTool: Tool = {
  name: BROWSER_SCREENSHOT,
  description: "Capture a PNG screenshot of the current page to a file and return its path.",
  permission: BROWSER,
  deferred: true,
  parameters: obj({ path: { type: "string", description: "output file path (defaults to ./friday-shot.png)" } }),
  async execute(input: any, ctx) {
    const out = path.resolve(ctx.cwd, String(input.path || "friday-shot.png"))
    return { output: `saved screenshot → ${await active().screenshot(out)}`, title: "screenshot" }
  },
}

const consoleTool: Tool = {
  name: BROWSER_CONSOLE,
  description: "Return console + log messages collected since the last call (errors, warnings, console.log).",
  permission: BROWSER,
  deferred: true,
  parameters: obj({}),
  async execute() {
    return { output: active().drainConsole(), title: "console" }
  },
}

const closeTool: Tool = {
  name: BROWSER_CLOSE,
  description: "Close the browser session.",
  permission: BROWSER,
  deferred: true,
  parameters: obj({}),
  async execute() {
    active().close()
    return { output: "browser closed", title: "close" }
  },
}

export const BROWSER_TOOL_LIST: Tool[] = [
  navigateTool,
  snapshotTool,
  clickTool,
  typeTool,
  evalTool,
  screenshotTool,
  consoleTool,
  closeTool,
]

/** Used by the /chrome command to pre-launch / tear down outside of a tool call. */
export async function startBrowser(opts?: { binary?: string; port?: number; userDataDir?: string }): Promise<string> {
  await active().start(opts?.binary, opts?.userDataDir, opts?.port)
  return `browser ready on :${active().port}`
}
export function closeBrowser(): void {
  session?.close()
}
