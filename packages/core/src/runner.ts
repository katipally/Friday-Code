import fs from "node:fs"
import path from "node:path"
import { formatDiagnostics, LspManager } from "@friday/lsp"
import { getProviderKey } from "@friday/providers"
import {
  type AskOption,
  type AskQuestion,
  type Effort,
  type EngineEventBody,
  getMode,
  type Message,
  type ModeId,
  type PermissionCategory,
  type ProviderInfo,
  type TodoItem,
  type TodoStatus,
  type ToolCall,
} from "@friday/shared"
import {
  ASK_USER,
  CRON_CREATE,
  CRON_DELETE,
  CRON_LIST,
  diffStats,
  ENTER_WORKTREE,
  EXIT_PLAN,
  EXIT_WORKTREE,
  LSP_DEFINITION,
  LSP_HOVER,
  LSP_SYMBOLS,
  LSP_TOOLS,
  MEMORY_TOOL,
  SEND_TO_TASK,
  SKILL_TOOL,
  searchTools,
  SPAWN_AGENTS,
  TASK_CREATE,
  TASK_LIST,
  TASK_STATUS,
  TASK_STOP,
  TASK_TOOL,
  TODO_WRITE,
  TOOL_SEARCH,
  type Tool,
  type ToolResult,
  toToolDef,
  unifiedDiff,
  WORKTREE_LIST,
} from "@friday/tools"
import { type AgentDef, loadAgents } from "./agents.ts"
import {
  applyFiles,
  type Checkpoint,
  deserializeCheckpoints,
  readOrNull,
  serializeCheckpoints,
  snapshotFile,
} from "./checkpoints.ts"
import { type CustomCommand, loadCommands } from "./commands.ts"
import { COMPACTION, collapseToolOutputs, estimateTokens, renderTranscript, safeCutIndex } from "./compaction.ts"
import { loadProjectContext, type ProjectContext } from "./context.ts"
import { formatFile } from "./format.ts"
import { gitCommitAll, gitDiff, gitIsTracked, gitShowHead, gitStatus, gitWorktreeAdd, gitWorktreeList } from "./git.ts"
import { type HookEvent, type HookPayload, type HooksConfig, runHooks } from "./hooks.ts"
import { deleteMemory, listMemory, memoryDigest, saveMemory } from "./memory.ts"
import { collectImages, expandMentions } from "./mentions.ts"
import { customAgentPrompt, subagentPrompt, systemPrompt } from "./prompt.ts"
import { bashRisk, matchesList } from "./safety.ts"
import type { PlanRow, SessionStore } from "./sessions.ts"
import { loadSkills, type Skill } from "./skills.ts"
import type { StreamFn } from "./stream.ts"

const now = () => Date.now()
const MAX_STEPS = 50

/** Heuristic: did a provider error come from the request exceeding the context window? These are not
 * retryable as-is (retrying the same request won't help) — but compacting first and retrying can. */
function isOverflowError(e: unknown): boolean {
  const m = (e instanceof Error ? e.message : String(e)).toLowerCase()
  return (
    m.includes("413") ||
    m.includes("request_too_large") ||
    m.includes("prompt_too_long") ||
    m.includes("too many tokens") ||
    m.includes("maximum context") ||
    m.includes("context length") ||
    (m.includes("too long") && m.includes("prompt")) ||
    (m.includes("token") && m.includes("exceed"))
  )
}

type Pending = { resolve: (d: "allow" | "deny") => void; category: PermissionCategory; command?: string }

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s || "{}")
  } catch {
    return {}
  }
}

/** Like safeParse but reports failure, so a tool whose streamed args were truncated/corrupt is
 * rejected (fed back as an error) instead of silently executing with `{}` (e.g. edit with no path). */
function tryParseArgs(s: string): { ok: true; value: unknown } | { ok: false } {
  const t = (s ?? "").trim()
  if (!t) return { ok: true, value: {} }
  try {
    return { ok: true, value: JSON.parse(t) }
  } catch {
    return { ok: false }
  }
}

/** Clamp a model-supplied todo status to the rendered enum (tolerate common aliases). */
function normTodoStatus(s?: string): TodoStatus {
  if (s === "pending" || s === "active" || s === "done") return s
  if (s === "in_progress" || s === "in-progress" || s === "running") return "active"
  if (s === "completed" || s === "complete" || s === "finished") return "done"
  return "pending"
}

/** Cap on accumulated streamed tool-call arguments — guards against a pathological provider OOM. */
const MAX_TOOL_ARGS = 1_000_000

/**
 * Safety net for when the model writes choices into the question text instead of the `options`
 * array (a common slip). Pulls out an inline `Options: [...]` / `Options: a, b, c` or a trailing
 * bulleted/numbered list so the UI can still render them as real selectable options.
 */
export function extractInlineOptions(raw: string): { question: string; options?: string[] } {
  const inline = raw.match(/\bOptions?\s*:\s*(.+?)\s*$/im)
  if (inline) {
    const body = inline[1]!.trim()
    const bracket = body.match(/^\[(.*)\]$/s)
    const opts = (bracket ? bracket[1]! : body)
      .split(/\s*,\s*/)
      .map((s) => s.replace(/^['"]|['"]$/g, "").trim())
      .filter(Boolean)
    if (opts.length >= 2) return { question: raw.slice(0, inline.index).trim() || "Pick one:", options: opts }
  }
  const lines = raw.split("\n")
  const isBullet = (l: string) => /^\s*(?:[-*•]|\d+[.)])\s+\S/.test(l)
  const start = lines.findIndex(isBullet)
  if (start >= 0) {
    const opts = lines
      .slice(start)
      .filter(isBullet)
      .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
    if (opts.length >= 2) return { question: lines.slice(0, start).join("\n").trim() || "Pick one:", options: opts }
  }
  return { question: raw }
}

/** Normalize a model-supplied option (a bare string or a { label, description } object) to an AskOption. */
function toAskOption(o: unknown): AskOption | null {
  if (typeof o === "string") return o.trim() ? { label: o.trim() } : null
  if (o && typeof o === "object") {
    const label = (o as any).label
    if (typeof label === "string" && label.trim()) {
      const description = (o as any).description
      const preview = (o as any).preview
      return {
        label: label.trim(),
        description: typeof description === "string" && description.trim() ? description.trim() : undefined,
        preview: typeof preview === "string" && preview.trim() ? preview.replace(/\s+$/, "") : undefined,
      }
    }
  }
  return null
}

/**
 * Build one AskQuestion, preferring explicit `options[]` (strings or { label, description } objects)
 * but falling back to extracting choices the model wrote inline in the question text.
 */
function toAskQuestion(
  id: string,
  question: string,
  explicit: unknown,
  multi = false,
  header?: string,
  art?: string,
): AskQuestion {
  const hdr = typeof header === "string" && header.trim() ? header.trim() : undefined
  const banner = typeof art === "string" && art.trim() ? art.replace(/\s+$/, "") : undefined
  if (Array.isArray(explicit) && explicit.length) {
    const options = explicit.map(toAskOption).filter((o): o is AskOption => o !== null)
    if (options.length) return { id, question, header: hdr, art: banner, options, multi }
  }
  const parsed = extractInlineOptions(question)
  return {
    id,
    question: parsed.question,
    header: hdr,
    art: banner,
    options: parsed.options?.map((label) => ({ label })),
    multi,
  }
}

/** Last path segment (filename) of a path-ish string. */
function baseName(p: string): string {
  const parts = String(p).split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || String(p)
}
/** Collapse whitespace and clip to `n` chars with an ellipsis — keeps status lines short. */
function clip(s: string, n = 24): string {
  const t = String(s).replace(/\s+/g, " ").trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}
/** Turn a tool call into a terse "verb + target" status line ("Reading runner.ts", "Running npm test")
 * so the rail says what the agent is actually doing rather than a generic "running <tool>". */
function describeWork(name: string, input: unknown): string {
  const a = (input && typeof input === "object" ? input : {}) as Record<string, any>
  switch (name) {
    case "read":
      return `Reading ${clip(baseName(a.path ?? ""))}`
    case "write":
      return `Writing ${clip(baseName(a.path ?? ""))}`
    case "edit":
    case "multi_edit":
      return `Editing ${clip(baseName(a.path ?? ""))}`
    case "bash":
      return `Running ${clip(a.command ?? "")}`
    case "grep":
      return `Searching ${clip(a.pattern ?? "")}`
    case "glob":
      return `Finding ${clip(a.pattern ?? "")}`
    case "ls":
      return `Listing ${clip(baseName(a.path ?? "."))}`
    case "webfetch":
      return `Fetching ${clip((a.url ?? "").replace(/^https?:\/\//, ""))}`
    case "websearch":
      return `Searching ${clip(a.query ?? "")}`
    case "skill":
      return `Skill ${clip(a.name ?? "")}`
    case "exit_plan":
      return "Finalizing plan"
    default:
      return name.startsWith("lsp_")
        ? `Analyzing ${clip(baseName(a.path ?? ""))}`
        : `Running ${name.replace(/_/g, " ")}`
  }
}

/** Render ask_user answers back to the model: a single answer verbatim, or labeled Q/A pairs. */
function formatAskAnswers(questions: AskQuestion[], answers: Record<string, string>): string {
  if (questions.length === 1) return answers[questions[0]!.id] ?? "(no answer)"
  return questions.map((q) => `Q: ${q.question}\nA: ${answers[q.id] ?? "(no answer)"}`).join("\n\n")
}

export interface SessionStats {
  messages: number
  tokens: number
  durationMs: number
}

/** Shared, manager-owned services a runner needs. */
export interface RunnerHost {
  streamFn: StreamFn
  store: SessionStore
  /** current tool registry (reflects MCP connect/disconnect) */
  registry: () => { list: Tool[]; defs: ReturnType<typeof toToolDef>[]; get(name: string): Tool | undefined }
  /** shared model/mode selection */
  selection: () => {
    providerId?: string
    model?: string
    reasoning: boolean
    effort: Effort
    mode: ModeId
    contextWindow: number
    cost?: { input: number; output: number }
    /** config.outputStyle — nudges prompt verbosity (concise | explanatory | minimal) */
    outputStyle?: string
  }
  resolveProvider: () => ProviderInfo
  /** globally-unique id source (so permission/ask requestIds don't collide across sessions) */
  nextId: () => string
  /** emit a body tagged with this runner's session id */
  emit: (sessionId: string, body: EngineEventBody) => void
  /** lifecycle hooks config */
  hooks: () => HooksConfig | undefined
  /** bash allow/deny lists */
  bashPolicy: () => { allow?: string[]; deny?: string[] } | undefined
  /** config.formatter — false disables auto-format-on-edit (undefined = on) */
  formatterEnabled: () => boolean | undefined
  /** per-project "always allow" rules (bash prefixes + categories) */
  projectPermissions: (root: string) => { bash?: string[]; categories?: PermissionCategory[] }
  /** persist an "allow always" decision for a project root */
  persistPermission: (root: string, rule: { category: PermissionCategory; command?: string }) => void
  /** spawn a detached background task (agent-driven session); optional isolated worktree; returns its id */
  spawnTask: (prompt: string, description: string, worktree?: string) => string
  /** fan out several subtasks as parallel background agents; returns their ids */
  spawnAgents: (jobs: { description: string; prompt: string; worktree?: string }[]) => string[]
  /** inject a follow-up prompt into a background task (queued if it's mid-turn) */
  sendToTask: (id: string, text: string) => boolean
  /** list background tasks with status */
  taskList: () => { id: string; title: string; description: string; status: "running" | "done"; summary?: string }[]
  /** stop a running background task */
  stopTask: (id: string) => void
  /** schedule a recurring background task */
  cronCreate: (description: string, prompt: string, every: string) => { ok: boolean; id?: string; error?: string }
  /** list scheduled recurring tasks */
  cronList: () => { id: string; description: string; everyMs: number; nextRun: number }[]
  /** delete a scheduled task */
  cronDelete: (id: string) => void
}

/**
 * Owns one session's mutable state and runs its agent loop. Multiple runners
 * execute concurrently; the manager (Engine) routes commands and multiplexes events.
 */
export class SessionRunner {
  readonly sessionId: string
  private title: string
  private roots: string[]
  private cwd: string
  private messages: Message[]
  private seq: number
  private startedAt = now()
  private totalTokens = 0
  /** input tokens the provider reported for the most recent request — the real size of the current
   * context, used to drive auto-compaction (more accurate than the char estimate). */
  private lastInputTokens = 0

  private context: ProjectContext
  private skills: Skill[]
  private agents: AgentDef[]
  private lsp: LspManager
  /** files with outstanding diagnostics, for the Files panel */
  private diag = new Map<string, { errors: number; warnings: number }>()

  private abort?: AbortController
  busy = false
  /** id of the assistant message currently streaming — so we can always finalize it (even on abort/error). */
  private activeAssistantId?: string
  /** set when the model explicitly presented a plan via exit_plan this turn — suppresses the fallback heuristic. */
  private planEmitted = false
  /** set while a permission/ask card is awaiting the user for this session */
  needsInput = false
  private pending = new Map<string, Pending>()
  private pendingAsk = new Map<string, (answers: Record<string, string>) => void>()
  private sessionAllow = new Set<PermissionCategory>()
  /** Deferred tools the model has activated via tool_search this session (their schemas are then sent). */
  private activatedTools = new Set<string>()

  private checkpoints: Checkpoint[] = []
  private currentCheckpoint?: Checkpoint
  private redoState?: { files: Map<string, string | null>; messages: Message[] }

  private todos: TodoItem[] = []
  private plans: PlanRow[] = []
  private compaction?: { summary: string; throughIndex: number }
  /** Abort controller for an in-flight compaction summarize call — lets the user STOP it. */
  private compactionAbort?: AbortController
  /** Snapshot of the compaction state from before the last compaction, so it can be UNDONE.
   * (Compaction never drops messages — it only changes what sendMessages() prepends/slices — so
   * reverting this field fully restores the pre-compaction context.) */
  private preCompaction?: { compaction?: { summary: string; throughIndex: number } }

  constructor(
    private host: RunnerHost,
    row: { id: string; title: string; roots: string[] },
    fallbackCwd: string,
  ) {
    this.sessionId = row.id
    this.title = row.title
    this.roots = row.roots.length ? row.roots : [fallbackCwd]
    this.cwd = this.roots[0]!
    this.messages = host.store.loadMessages(row.id)
    this.seq = this.messages.length
    // Restore per-session UI state (todos, plans, rewind checkpoints) so resuming feels continuous.
    this.todos = host.store.loadTodos(row.id)
    this.plans = host.store.loadPlans(row.id)
    this.checkpoints = deserializeCheckpoints(host.store.loadCheckpointsJson(row.id))
    this.context = loadProjectContext(this.roots)
    this.skills = loadSkills(this.roots)
    this.agents = loadAgents(this.roots)
    this.lsp = new LspManager(this.cwd)
    void this.hook("SessionStart")
  }

  private emit(body: EngineEventBody): void {
    this.host.emit(this.sessionId, body)
  }

  private hook(event: HookEvent, extra: Partial<HookPayload> = {}, matchKey?: string) {
    return runHooks(event, this.host.hooks(), { event, session_id: this.sessionId, cwd: this.cwd, ...extra }, matchKey)
  }

  /**
   * Files this session has modified, derived from its own checkpoint snapshots
   * (not git) — so the panel reflects exactly what THIS session touched.
   */
  private emitSessionFiles(): void {
    const prior = new Map<string, string | null>() // path -> content before this session first touched it
    for (const cp of this.checkpoints) for (const [abs, before] of cp.files) if (!prior.has(abs)) prior.set(abs, before)
    const items: { path: string; status: string; added: number; removed: number; kind?: "file" | "dir" }[] = []
    const addedAbs = new Set<string>()
    const removedAbs = new Set<string>()
    for (const [abs, before] of prior) {
      const cur = readOrNull(abs)
      if (before === cur) continue // touched but reverted to original — no net change
      const status = before === null ? "A" : cur === null ? "D" : "M"
      if (status === "A") addedAbs.add(abs)
      else if (status === "D") removedAbs.add(abs)
      const { added, removed } = diffStats(unifiedDiff(before ?? "", cur ?? ""))
      items.push({ path: path.relative(this.cwd, abs) || abs, status, added, removed, kind: "file" })
    }
    // Surface folders this session created/removed wholesale (e.g. `A src/utils/`) alongside files.
    for (const d of this.deriveDirChanges(addedAbs, removedAbs)) items.push(d)
    items.sort((a, b) => a.path.localeCompare(b.path))
    this.emit({ type: "session-files", items })
  }

  /**
   * Derive folder add/remove entries from the per-file change sets. A directory is "added" when it
   * exists and every entry under it (recursively) is a session-created file — i.e. the whole folder
   * is new (so we never flag a pre-existing dir that merely gained one file). A directory is
   * "removed" when it no longer exists but is an ancestor of a removed file and its parent still
   * exists (so we report the top of the deleted subtree once). Both are conservative — disk checks
   * are wrapped so a transient FS error never breaks the panel.
   */
  private deriveDirChanges(
    addedAbs: Set<string>,
    removedAbs: Set<string>,
  ): { path: string; status: string; added: number; removed: number; kind: "dir" }[] {
    const out: { path: string; status: string; added: number; removed: number; kind: "dir" }[] = []
    const rel = (d: string) => `${path.relative(this.cwd, d) || d}/`
    // Ancestor dirs of `abs`, from its immediate parent up to (but excluding) the session cwd.
    const ancestors = (abs: string): string[] => {
      const acc: string[] = []
      let d = path.dirname(abs)
      while (true) {
        const r = path.relative(this.cwd, d)
        if (!r || r.startsWith("..") || path.isAbsolute(r)) break
        acc.push(d)
        const up = path.dirname(d)
        if (up === d) break
        d = up
      }
      return acc
    }
    const isFullyNew = (dir: string): boolean => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        if (entries.length === 0) return false
        for (const e of entries) {
          const child = path.join(dir, e.name)
          if (e.isDirectory()) {
            if (!isFullyNew(child)) return false
          } else if (e.isFile()) {
            if (!addedAbs.has(child)) return false
          } else return false // symlink / special — be conservative
        }
        return true
      } catch {
        return false
      }
    }

    // Added: shallowest fully-new directories.
    const newDirs = new Set<string>()
    for (const f of addedAbs) for (const d of ancestors(f)) if (!newDirs.has(d) && isFullyNew(d)) newDirs.add(d)
    for (const d of newDirs) {
      if (newDirs.has(path.dirname(d))) continue // keep only the top-most new dir
      out.push({ path: rel(d), status: "A", added: 0, removed: 0, kind: "dir" })
    }

    // Removed: top of each deleted subtree (gone now, but parent still present).
    const seen = new Set<string>()
    for (const f of removedAbs)
      for (const d of ancestors(f)) {
        if (seen.has(d)) continue
        seen.add(d)
        try {
          if (!fs.existsSync(d) && fs.existsSync(path.dirname(d))) {
            out.push({ path: rel(d), status: "D", added: 0, removed: 0, kind: "dir" })
          }
        } catch {
          /* ignore */
        }
      }
    return out
  }

  // ---- public accessors (used by the manager / UI) ----
  currentTitle(): string {
    return this.title
  }
  currentCwd(): string {
    return this.cwd
  }
  currentRoots(): string[] {
    return this.roots
  }
  /** A session with no messages yet — a throwaway "new session" placeholder, safe to discard. */
  isEmpty(): boolean {
    return this.messages.length === 0
  }
  /** A copy of this session's messages (for forking a branch). */
  snapshotMessages(): Message[] {
    return [...this.messages]
  }
  /** The user turns in this conversation, with their message index — the fork/timeline points. */
  forkPoints(): { index: number; text: string }[] {
    const out: { index: number; text: string }[] = []
    this.messages.forEach((m, index) => {
      if (m.role === "user") out.push({ index, text: (m.text ?? "").replace(/\s+/g, " ").trim().slice(0, 80) })
    })
    return out
  }
  contextInfo(): { files: string[] } {
    return { files: this.context.files }
  }
  listSkills(): { name: string; description: string }[] {
    return this.skills.map((s) => ({ name: s.name, description: s.description }))
  }
  listCommands(): CustomCommand[] {
    return loadCommands(this.roots)
  }
  stats(): SessionStats {
    const messages = this.messages.filter((m) => m.role === "user" || m.role === "assistant").length
    return { messages, tokens: this.totalTokens, durationMs: now() - this.startedAt }
  }
  listCheckpoints(): { id: string; label: string; createdAt: number; files: number }[] {
    // Chronological: oldest first, newest last (the UI focuses the newest at the bottom).
    return this.checkpoints.map((c) => ({ id: c.id, label: c.label, createdAt: c.createdAt, files: c.files.size }))
  }
  hasRedo(): boolean {
    return !!this.redoState
  }

  private persistCheckpoints(): void {
    this.host.store.setCheckpointsJson(this.sessionId, serializeCheckpoints(this.checkpoints))
  }
  /** Record a plan (title = first non-empty line), persist it, and surface the execute gate. */
  private recordPlan(plan: string): void {
    const title =
      plan
        .split("\n")
        .map((s) => s.trim())
        .find(Boolean)
        ?.replace(/^#+\s*/, "")
        .slice(0, 60) ?? "plan"
    this.plans.push({ id: this.host.nextId(), title, text: plan })
    this.host.store.setPlans(this.sessionId, this.plans)
    this.emit({ type: "plan-ready", plan })
  }

  /** Emit this session's full current state (on focus / resume). */
  emitState(includeMessages: boolean): void {
    this.emit({
      type: "session-changed",
      sessionId: this.sessionId,
      title: this.title,
      cwd: this.cwd,
      roots: this.roots,
    })
    if (includeMessages)
      this.emit({
        type: "session-loaded",
        sessionId: this.sessionId,
        title: this.title,
        cwd: this.cwd,
        roots: this.roots,
        messages: this.messages,
      })
    this.emit({ type: "todos", items: this.todos })
    this.emit({ type: "plans", items: this.plans })
    this.emitSessionFiles()
  }

  addRoot(dir: string): void {
    if (this.roots.includes(dir)) return
    this.roots = this.host.store.addRoot(this.sessionId, dir, now())
    this.context = loadProjectContext(this.roots)
    this.skills = loadSkills(this.roots)
    this.agents = loadAgents(this.roots)
    this.emit({
      type: "session-changed",
      sessionId: this.sessionId,
      title: this.title,
      cwd: this.cwd,
      roots: this.roots,
    })
  }

  /** Working dir + roots saved before entering a worktree, so exit can restore them. */
  private preWorktree?: { cwd: string; roots: string[] }
  /** Create/reuse a git worktree and switch this session's cwd into it (tools then resolve there). */
  async enterWorktree(name: string): Promise<{ ok: boolean; info: string }> {
    const res = await gitWorktreeAdd(this.cwd, name)
    if (!res.ok || !res.path) return { ok: false, info: res.info }
    if (!this.preWorktree) this.preWorktree = { cwd: this.cwd, roots: [...this.roots] }
    this.cwd = res.path
    this.roots = [res.path, ...this.roots.filter((r) => r !== res.path)]
    this.context = loadProjectContext(this.roots)
    this.skills = loadSkills(this.roots)
    this.agents = loadAgents(this.roots)
    this.emit({
      type: "session-changed",
      sessionId: this.sessionId,
      title: this.title,
      cwd: this.cwd,
      roots: this.roots,
    })
    return { ok: true, info: `entered worktree at ${res.path}` }
  }
  /** Switch back to the working dir saved before the last enterWorktree. */
  exitWorktree(): { ok: boolean; info: string } {
    if (!this.preWorktree) return { ok: false, info: "not in a worktree" }
    this.cwd = this.preWorktree.cwd
    this.roots = this.preWorktree.roots
    this.preWorktree = undefined
    this.context = loadProjectContext(this.roots)
    this.skills = loadSkills(this.roots)
    this.agents = loadAgents(this.roots)
    this.emit({
      type: "session-changed",
      sessionId: this.sessionId,
      title: this.title,
      cwd: this.cwd,
      roots: this.roots,
    })
    return { ok: true, info: `back to ${this.cwd}` }
  }

  // ---- command handling ----
  abortRun(): void {
    this.abort?.abort()
    this.settleInputWaiters()
  }
  dispose(): void {
    this.abort?.abort()
    this.settleInputWaiters()
    this.lsp.dispose()
  }
  /** Release any in-flight permission/ask awaits (deny / no-answer) so the agent loop unwinds on
   * abort instead of hanging forever on a promise the user will never answer. */
  private settleInputWaiters(): void {
    if (this.pending.size === 0 && this.pendingAsk.size === 0) return
    for (const p of this.pending.values()) p.resolve("deny")
    this.pending.clear()
    for (const r of this.pendingAsk.values()) r({})
    this.pendingAsk.clear()
    this.needsInput = false
  }
  handlePermissionReply(requestId: string, decision: "allow-once" | "allow-always" | "deny"): boolean {
    const p = this.pending.get(requestId)
    if (!p) return false
    this.pending.delete(requestId)
    if (decision === "allow-always") {
      this.sessionAllow.add(p.category)
      // Remember it for this project so the same action auto-approves in future sessions too.
      this.host.persistPermission(this.roots[0] ?? this.cwd, { category: p.category, command: p.command })
    }
    this.needsInput = this.pending.size > 0 || this.pendingAsk.size > 0
    p.resolve(decision === "deny" ? "deny" : "allow")
    return true
  }
  handleAskReply(requestId: string, answers: Record<string, string>): boolean {
    const r = this.pendingAsk.get(requestId)
    if (!r) return false
    this.pendingAsk.delete(requestId)
    this.needsInput = this.pending.size > 0 || this.pendingAsk.size > 0
    r(answers)
    return true
  }

  private addMessage(msg: Message): void {
    this.messages.push(msg)
    this.host.store.appendMessage(this.sessionId, this.seq++, msg)
    this.host.store.touch(this.sessionId, now())
  }

  private setTitleFromPrompt(typed: string): void {
    if (this.title && this.title !== "new session") return
    const cleaned = typed.replace(/@\S+/g, "").replace(/`+/g, "").replace(/\s+/g, " ").trim()
    if (!cleaned) return
    let title = cleaned.slice(0, 48).replace(/[.,;:!?]+$/, "")
    title = title.charAt(0).toUpperCase() + title.slice(1)
    this.title = title
    this.host.store.rename(this.sessionId, title, now())
    this.emit({ type: "session-changed", sessionId: this.sessionId, title, cwd: this.cwd, roots: this.roots })
  }

  /** After a bash command, snapshot the prior content of files it changed into the current checkpoint
   * so `/undo` can revert them too. `before` is the set of git-changed paths captured pre-command:
   *  - a path newly changed that's tracked → its pre-bash content is HEAD (it was clean before), or
   *  - newly changed + untracked → it was created by bash, so prior content is null (undo deletes it).
   * Files already dirty before the command are left to their own (edit-tool) snapshots. */
  private async snapshotBashChanges(before: Set<string>): Promise<void> {
    const cp = this.currentCheckpoint
    if (!cp) return
    const after = await gitStatus(this.cwd)
    if (!after.repo) return
    for (const f of after.files) {
      if (before.has(f.path)) continue
      const abs = path.resolve(this.cwd, f.path)
      if (cp.files.has(abs)) continue
      const tracked = await gitIsTracked(this.cwd, f.path)
      cp.files.set(abs, tracked ? await gitShowHead(this.cwd, f.path) : null)
    }
  }

  // ---- checkpoints / undo ----
  /** Rewind to a checkpoint. `scope` selects what is restored, Claude-Code-style:
   *  - "both"          → files + conversation (the default).
   *  - "code"          → only revert the files; keep the chat as-is.
   *  - "conversation"  → only truncate the chat back; leave the files on disk.
   */
  restoreCheckpoint(id: string, scope: "both" | "code" | "conversation" = "both"): void {
    if (this.busy) return
    const idx = this.checkpoints.findIndex((c) => c.id === id)
    if (idx < 0) return
    const cp = this.checkpoints[idx]!
    const tail = this.checkpoints.slice(idx)

    // Always snapshot current state first so the rewind itself can be redone.
    const redoFiles = new Map<string, string | null>()
    for (const c of tail) for (const p of c.files.keys()) if (!redoFiles.has(p)) redoFiles.set(p, readOrNull(p))
    this.redoState = { files: redoFiles, messages: [...this.messages] }

    if (scope !== "conversation") {
      const restore = new Map<string, string | null>()
      for (const c of tail) for (const [p, prior] of c.files) if (!restore.has(p)) restore.set(p, prior)
      applyFiles(restore)
    }

    if (scope !== "code") {
      this.messages = this.messages.slice(0, cp.messageSeq)
      this.seq = cp.messageSeq
      this.host.store.truncateMessages(this.sessionId, cp.messageSeq)
      this.checkpoints = this.checkpoints.slice(0, idx)
      this.currentCheckpoint = undefined
      // Drop any compaction summary — its throughIndex points into the now-truncated history and
      // would otherwise make sendMessages() prepend a stale summary / slice the wrong range.
      this.compaction = undefined
    }

    if (scope !== "code") this.persistCheckpoints() // the checkpoint list was truncated
    const what = scope === "code" ? "files" : scope === "conversation" ? "conversation" : `to “${cp.label}”`
    this.emit({ type: "status", text: `rewound ${what}` })
    this.emit({
      type: "session-loaded",
      sessionId: this.sessionId,
      title: this.title,
      cwd: this.cwd,
      roots: this.roots,
      messages: this.messages,
    })
  }

  redoLast(): void {
    if (this.busy || !this.redoState) return
    applyFiles(this.redoState.files)
    this.messages = [...this.redoState.messages]
    this.seq = this.messages.length
    this.compaction = undefined // rebuilt history — a stale summary index would corrupt context
    this.host.store.truncateMessages(this.sessionId, 0)
    this.messages.forEach((m, i) => {
      this.host.store.appendMessage(this.sessionId, i, m)
    })
    this.redoState = undefined
    this.emit({ type: "status", text: "redone" })
    this.emit({
      type: "session-loaded",
      sessionId: this.sessionId,
      title: this.title,
      cwd: this.cwd,
      roots: this.roots,
      messages: this.messages,
    })
  }

  // ---- the agentic loop ----
  async runPrompt(text: string): Promise<void> {
    if (this.busy) return
    const sel = this.host.selection()
    if (!sel.model || !sel.providerId) {
      this.emit({ type: "error", message: "No model selected — open /model to connect one." })
      return
    }
    // Acknowledge the submit instantly so the UI never feels dead between Enter and first token.
    this.emit({ type: "mascot", state: "thinking" })
    this.emit({ type: "status", text: "sent…" })

    // UserPromptSubmit hook may block the prompt or inject extra context.
    const pre = await this.hook("UserPromptSubmit", { prompt: text })
    if (pre.block) {
      this.emit({ type: "error", message: pre.reason ?? "Prompt blocked by a hook." })
      this.emit({ type: "mascot", state: "idle" })
      this.emit({ type: "status", text: "ready" })
      return
    }

    this.busy = true
    this.planEmitted = false
    this.abort = new AbortController()
    this.currentCheckpoint = {
      id: this.host.nextId(),
      label: text.replace(/\s+/g, " ").trim().slice(0, 60) || "turn",
      createdAt: now(),
      messageSeq: this.messages.length,
      files: new Map(),
    }
    this.checkpoints.push(this.currentCheckpoint)
    this.redoState = undefined
    const { text: expanded, files } = expandMentions(text, this.roots)
    let promptText = await this.augmentSymbols(text, expanded, files)
    if (pre.context) promptText += `\n\n<hook_context>\n${pre.context}\n</hook_context>`
    const images = collectImages(text, this.roots)
    this.addMessage({ role: "user", text: promptText, images: images.length ? images : undefined })
    this.setTitleFromPrompt(text)
    const start = now()
    try {
      await this.loop(start)
    } catch (e: any) {
      if (!this.abort.signal.aborted) this.emit({ type: "error", message: e?.message ?? String(e) })
    } finally {
      const aborted = this.abort?.signal.aborted ?? false
      this.busy = false
      this.abort = undefined
      // Always finalize the in-flight assistant item so the UI clears `busy` (stops the timer)
      // and marks the bubble done — turn-done is the ONLY event the UI uses for this, and the
      // normal path may not have emitted it (abort / error / step-limit).
      if (this.activeAssistantId) {
        this.emit({ type: "turn-done", id: this.activeAssistantId })
        this.activeAssistantId = undefined
      }
      void this.hook("Stop")
      this.emitSessionFiles()
      // The turn's checkpoint now has all its file snapshots — persist so rewind survives a restart.
      this.persistCheckpoints()
      // Fallback: if the model finished a plan-mode turn WITHOUT calling exit_plan, still surface
      // something so the gate isn't lost — the plan is the last assistant message produced this turn.
      // The deterministic path (exit_plan) is preferred; this only runs when it wasn't used.
      if (!aborted && !this.planEmitted && this.host.selection().mode === "plan") {
        const last = [...this.messages].reverse().find((m) => m.role === "assistant" && !!m.text)
        if (last && last.role === "assistant" && last.text && last.text.trim().length > 12) {
          this.recordPlan(last.text)
        }
      }
      this.emit({ type: "mascot", state: "idle" })
      this.emit({ type: "status", text: aborted ? "stopped" : "ready" })
    }
  }

  private async collectTurn(
    gen: AsyncGenerator<import("@friday/shared").ProviderEvent>,
    signal: AbortSignal,
    on: {
      text?: (d: string) => void
      reasoning?: (d: string) => void
      usage?: (input: number, output: number) => void
    },
  ): Promise<{ text: string; reasoning: string; reasoningSignature: string; toolCalls: ToolCall[] }> {
    let text = ""
    let reasoning = ""
    let reasoningSignature = ""
    const calls = new Map<number, { id: string; name: string; args: string }>()
    for await (const ev of gen) {
      if (signal.aborted) break
      switch (ev.type) {
        case "text":
          text += ev.delta
          on.text?.(ev.delta)
          break
        case "reasoning":
          reasoning += ev.delta
          on.reasoning?.(ev.delta)
          break
        case "reasoning_signature":
          reasoningSignature += ev.signature
          break
        case "tool_start": {
          const c = calls.get(ev.index) ?? { id: "", name: "", args: "" }
          if (ev.id) c.id = ev.id
          if (ev.name) c.name = ev.name
          calls.set(ev.index, c)
          break
        }
        case "tool_delta": {
          const c = calls.get(ev.index) ?? { id: "", name: "", args: "" }
          if (c.args.length + ev.argsDelta.length > MAX_TOOL_ARGS)
            throw new Error("tool arguments exceeded the size limit")
          c.args += ev.argsDelta
          calls.set(ev.index, c)
          break
        }
        case "usage":
          on.usage?.(ev.input, ev.output)
          break
      }
    }
    const toolCalls: ToolCall[] = [...calls.values()]
      .filter((c) => c.name)
      .map((c) => ({ id: c.id || this.host.nextId(), name: c.name, arguments: c.args || "{}" }))
    return { text, reasoning, reasoningSignature, toolCalls }
  }

  // ---- compaction ----
  private sendMessages(): Message[] {
    const base = this.compaction
      ? [
          {
            role: "user",
            text: `<conversation_summary>\nEarlier conversation, condensed for context:\n${this.compaction.summary}\n</conversation_summary>`,
          } as Message,
          ...this.messages.slice(this.compaction.throughIndex),
        ]
      : this.messages
    // Microcompaction: shrink stale, large tool dumps before sending (recoverable — originals stay in
    // this.messages). Note: project memory (FRIDAY.md/AGENTS.md) lives in the system prompt, which is
    // rebuilt every turn, so it always survives compaction — no separate re-injection needed.
    return collapseToolOutputs(base)
  }

  private async maybeCompact(
    provider: ProviderInfo,
    apiKey: string | undefined,
    signal: AbortSignal,
    force: boolean,
  ): Promise<void> {
    const window = this.host.selection().contextWindow || COMPACTION.defaultWindow
    // Trigger off the real input-token count of the last request (most accurate proxy for the
    // current context size); fall back to the char estimate before the first usage arrives.
    const limit = Math.min(Math.floor(window * COMPACTION.threshold), window - COMPACTION.buffer)
    const used = this.lastInputTokens > 0 ? this.lastInputTokens : estimateTokens(this.sendMessages())
    if (!force && used < limit) return
    const floor = this.compaction?.throughIndex ?? 0
    const cut = safeCutIndex(this.messages, this.messages.length - COMPACTION.keepRecent, floor)
    if (cut <= floor) return
    const pct = (n: number) => Math.min(100, Math.round((n / window) * 100))
    void this.hook("PreCompact")

    // A dedicated controller so the user can STOP this compaction; the enclosing run's signal
    // (loop abort) also cancels it.
    this.compactionAbort = new AbortController()
    if (signal.aborted) return this.compactionAbort.abort()
    signal.addEventListener("abort", () => this.compactionAbort?.abort(), { once: true })

    this.emit({ type: "compaction-start", tokensBefore: used, pctBefore: pct(used), window })
    this.emit({ type: "status", text: "compacting context…" })
    const summary = await this.summarize(
      provider,
      apiKey,
      this.compactionAbort.signal,
      this.messages.slice(0, cut),
      this.compaction?.summary,
    )
    if (this.compactionAbort.signal.aborted || !summary) {
      this.compactionAbort = undefined
      this.emit({ type: "compaction-aborted" })
      return
    }
    this.compactionAbort = undefined

    // Snapshot the prior state so this compaction can be undone (history itself is untouched).
    this.preCompaction = { compaction: this.compaction }
    this.compaction = { summary, throughIndex: cut }
    const after = estimateTokens(this.sendMessages())
    this.emit({
      type: "compaction",
      turnsCompacted: cut - floor,
      kept: this.messages.length - cut,
      tokensBefore: used,
      tokensAfter: after,
      summary,
      pctAfter: pct(after),
    })
  }

  /** Stop an in-flight compaction (the summarize call); history is left untouched. */
  stopCompaction(): void {
    this.compactionAbort?.abort()
  }

  /** Undo the most recent compaction: revert to the pre-compaction summary state (full history was
   * never dropped, so reverting the summary index restores the complete context). */
  undoCompaction(): void {
    if (this.busy) {
      this.emit({ type: "status", text: "can't undo while running" })
      return
    }
    if (!this.preCompaction) {
      this.emit({ type: "status", text: "nothing to undo" })
      return
    }
    this.compaction = this.preCompaction.compaction
    this.preCompaction = undefined
    this.emit({ type: "notice", text: "↺ compaction undone — full history restored" })
    this.emit({ type: "status", text: "ready" })
  }

  private async summarize(
    provider: ProviderInfo,
    apiKey: string | undefined,
    signal: AbortSignal,
    msgs: Message[],
    prior?: string,
  ): Promise<string> {
    const instruction = [
      prior ? `An earlier summary exists; extend it without repeating:\n${prior}\n` : "",
      "Summarize the conversation below for continuity. Preserve the user's goals, key decisions, file paths created or edited, important findings, and any unfinished tasks. Use terse bullet points. Output only the summary.",
      "",
      "Conversation:",
      renderTranscript(msgs),
    ]
      .filter(Boolean)
      .join("\n")
    const req = {
      model: this.host.selection().model!,
      messages: [
        {
          role: "system",
          text: "You compress coding-session transcripts into concise, faithful summaries.",
        } as Message,
        { role: "user", text: instruction } as Message,
      ],
      tools: [],
      maxTokens: 1024,
    }
    let text = ""
    try {
      for await (const ev of this.host.streamFn(provider, apiKey, req, signal)) {
        if (signal.aborted) break
        if (ev.type === "text") text += ev.delta
      }
    } catch {
      return prior ?? ""
    }
    return text.trim() || prior || ""
  }

  async forceCompact(): Promise<void> {
    const sel = this.host.selection()
    if (!sel.model || !sel.providerId) return this.emit({ type: "error", message: "Select a model first (/model)." })
    if (this.busy) return this.emit({ type: "status", text: "busy — compaction runs automatically" })
    if (this.messages.length <= COMPACTION.keepRecent)
      return this.emit({ type: "status", text: "nothing to compact yet" })
    const provider = this.host.resolveProvider()
    const apiKey = getProviderKey(provider.id)
    this.emit({ type: "mascot", state: "working" })
    await this.maybeCompact(provider, apiKey, new AbortController().signal, true)
    this.emit({ type: "mascot", state: "idle" })
    this.emit({ type: "status", text: "ready" })
  }

  private async loop(start: number): Promise<void> {
    const sel = this.host.selection()
    const provider = this.host.resolveProvider()
    const apiKey = getProviderKey(provider.id)
    const registry = this.host.registry()
    const signal = this.abort!.signal
    let inTok = 0
    let outTok = 0

    for (let step = 0; step < MAX_STEPS; step++) {
      if (signal.aborted) return
      const id = this.host.nextId()
      this.activeAssistantId = id
      this.emit({ type: "message-start", role: "assistant", id, mode: sel.mode })
      this.emit({ type: "mascot", state: "thinking" })
      this.emit({ type: "status", text: "Connecting…", elapsedMs: now() - start })

      await this.maybeCompact(provider, apiKey, signal, false)

      const req = {
        model: sel.model!,
        messages: [
          {
            role: "system",
            text: systemPrompt({
              cwd: this.cwd,
              roots: this.roots,
              mode: sel.mode,
              context: this.context.content,
              skills: this.skills.map((s) => ({ name: s.name, description: s.description, whenToUse: s.whenToUse })),
              agents: this.agents.map((a) => ({ name: a.name, description: a.description })),
              // Advertise deferred tools (by name) that aren't yet activated, so the model knows to search.
              deferredTools: registry.list
                .filter((t) => t.deferred && !this.activatedTools.has(t.name))
                .map((t) => ({ name: t.name, description: t.description })),
              memory: memoryDigest(),
              providerId: provider.id,
              outputStyle: sel.outputStyle,
            }),
          } as Message,
          ...this.sendMessages(),
        ],
        // Plan mode is STRICTLY read-only: only non-mutating tools (read/network/control + exit_plan)
        // are offered, so the agent can investigate and propose but can NEVER edit files or run bash —
        // it physically can't act, it can only plan. Every other mode hides exit_plan so the model can't
        // "present a plan" mid-execution. Deferred tools are hidden until activated via tool_search.
        tools: registry.defs.filter((d) => {
          const t = registry.get(d.name)
          if (t?.deferred && !this.activatedTools.has(d.name)) return false
          if (sel.mode === "plan")
            return !t || !["edit", "bash", "browser", "computer"].includes(t.permission)
          return d.name !== EXIT_PLAN
        }),
        effort: sel.reasoning ? sel.effort : undefined,
        maxTokens: 8192,
      }

      let streamedText = false
      let streamedReasoning = false
      const handlers = {
        text: (d: string) => {
          if (!streamedText) {
            streamedText = true
            this.emit({ type: "mascot", state: "streaming" })
            this.emit({ type: "status", text: "Responding…", elapsedMs: now() - start })
          }
          this.emit({ type: "text", id, delta: d })
        },
        reasoning: (d: string) => {
          if (!streamedReasoning) {
            streamedReasoning = true
            this.emit({ type: "status", text: "Thinking…", elapsedMs: now() - start })
          }
          this.emit({ type: "reasoning", id, delta: d })
        },
        usage: (i: number, o: number) => {
          inTok += i
          outTok += o
          this.totalTokens += i + o
          // The input figure for a request is the full context it ingested → remember the latest as
          // the current context size (drives auto-compaction). Don't sum it across steps.
          if (i > 0) this.lastInputTokens = i
          const cost =
            sel.cost && sel.cost.input != null && sel.cost.output != null
              ? (inTok / 1_000_000) * sel.cost.input + (outTok / 1_000_000) * sel.cost.output
              : undefined
          this.emit({ type: "usage", input: inTok, output: outTok, costUsd: cost })
        },
      }
      let turn: { text: string; reasoning: string; reasoningSignature: string; toolCalls: ToolCall[] }
      try {
        turn = await this.collectTurn(this.host.streamFn(provider, apiKey, req, signal), signal, handlers)
      } catch (e) {
        // Reactive compaction: a proactive trigger can under-estimate (a huge tool result, a bad
        // estimate) and the request overflows the window. Compact once and retry the same step —
        // nothing streamed yet on an overflow, so re-running the handlers is safe.
        if (signal.aborted || !isOverflowError(e) || streamedText || streamedReasoning) throw e
        this.emit({ type: "status", text: "context overflow — compacting…", elapsedMs: now() - start })
        await this.maybeCompact(provider, apiKey, signal, true)
        req.messages = [req.messages[0]!, ...this.sendMessages()]
        turn = await this.collectTurn(this.host.streamFn(provider, apiKey, req, signal), signal, handlers)
      }
      const { text, reasoning, reasoningSignature, toolCalls } = turn
      if (signal.aborted) return

      this.addMessage({
        role: "assistant",
        text: text || undefined,
        reasoning: reasoning || undefined,
        reasoningSignature: reasoningSignature || undefined,
        toolCalls: toolCalls.length ? toolCalls : undefined,
      })

      if (!toolCalls.length) {
        this.emit({ type: "turn-done", id })
        this.activeAssistantId = undefined
        return
      }

      // This step ends in tool calls, so a new assistant bubble will open next step. Finalize THIS
      // bubble now (stops its streaming caret) without ending the turn — busy stays true.
      this.emit({ type: "message-stop", id, intermediate: true })

      for (const tc of toolCalls) {
        if (signal.aborted) return

        if (tc.name === TODO_WRITE) {
          const a = safeParse(tc.arguments) as { todos?: { text?: string; status?: string }[] }
          this.todos = (a.todos ?? [])
            .filter((t) => t.text)
            .map((t, i) => ({ id: `t${i}`, text: t.text!, status: normTodoStatus(t.status) }))
          this.emit({ type: "todos", items: this.todos })
          this.host.store.setTodos(this.sessionId, this.todos)
          const rendered = this.todos.length
            ? this.todos
                .map((t) => `${t.status === "done" ? "[x]" : t.status === "active" ? "[~]" : "[ ]"} ${t.text}`)
                .join("\n")
            : "(list cleared)"
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: `Todos updated:\n${rendered}` })
          continue
        }

        const parsedArgs = safeParse(tc.arguments)
        this.emit({ type: "tool-call", id, callId: tc.id, name: tc.name, input: parsedArgs })
        this.emit({ type: "mascot", state: "working" })
        this.emit({ type: "status", text: describeWork(tc.name, parsedArgs), elapsedMs: now() - start })

        if (tc.name === EXIT_PLAN) {
          // The model has presented a finished plan. Emit it deterministically and LOCK the turn —
          // returning from loop() ends the agentic loop the instant the plan is ready.
          const a = safeParse(tc.arguments) as { plan?: string }
          const plan = (a.plan ?? "").trim()
          this.planEmitted = true
          this.addMessage({
            role: "tool",
            callId: tc.id,
            name: tc.name,
            result: "Plan presented to the user for approval.",
          })
          this.emit({ type: "tool-result", callId: tc.id, ok: true, output: plan, title: "plan ready" })
          this.recordPlan(plan)
          this.emit({ type: "turn-done", id })
          this.activeAssistantId = undefined
          return
        }

        if (tc.name === TOOL_SEARCH) {
          const a = safeParse(tc.arguments) as { query?: string }
          const pool = this.host
            .registry()
            .list.filter((t) => t.deferred)
            .map((t) => ({ name: t.name, description: t.description }))
          const hits = searchTools(a.query ?? "", pool)
          for (const h of hits) this.activatedTools.add(h.name) // available on the next step
          const output = hits.length
            ? `Loaded ${hits.length} tool(s) — now callable:\n${hits.map((h) => `- ${h.name}: ${h.description}`).join("\n")}`
            : "No matching tools found."
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: output })
          this.emit({ type: "tool-result", callId: tc.id, ok: true, output, title: `tool_search: ${a.query ?? ""}` })
          continue
        }

        if (tc.name === TASK_CREATE) {
          const a = safeParse(tc.arguments) as { description?: string; prompt?: string; worktree?: string }
          const id = this.host.spawnTask(a.prompt ?? "", a.description ?? "task", a.worktree?.trim() || undefined)
          const where = a.worktree ? ` (isolated in worktree “${a.worktree}”)` : ""
          const output = `Started background task ${id} — “${clip(a.description ?? "task")}”${where}. Check it with task_status({ id: "${id}" }).`
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: output })
          this.emit({
            type: "tool-result",
            callId: tc.id,
            ok: true,
            output,
            title: `task_create: ${clip(a.description ?? "")}`,
          })
          continue
        }
        if (tc.name === TASK_LIST) {
          const list = this.host.taskList()
          const output = list.length
            ? list.map((t) => `- ${t.id} [${t.status}] ${t.title}`).join("\n")
            : "No background tasks."
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: output })
          this.emit({ type: "tool-result", callId: tc.id, ok: true, output, title: "task_list" })
          continue
        }
        if (tc.name === TASK_STATUS) {
          const a = safeParse(tc.arguments) as { id?: string }
          const t = this.host.taskList().find((x) => x.id === a.id)
          const output = t
            ? `${t.id} [${t.status}] ${t.title}\n\n${t.summary ?? "(no output yet)"}`
            : `No task with id ${a.id}.`
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: output, isError: !t })
          this.emit({ type: "tool-result", callId: tc.id, ok: !!t, output, title: `task_status ${a.id ?? ""}` })
          continue
        }
        if (tc.name === TASK_STOP) {
          const a = safeParse(tc.arguments) as { id?: string }
          this.host.stopTask(a.id ?? "")
          const output = `Stopped task ${a.id}.`
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: output })
          this.emit({ type: "tool-result", callId: tc.id, ok: true, output, title: `task_stop ${a.id ?? ""}` })
          continue
        }
        if (tc.name === SPAWN_AGENTS) {
          const a = safeParse(tc.arguments) as {
            jobs?: { description?: string; prompt?: string; worktree?: string }[]
          }
          const jobs = (a.jobs ?? [])
            .filter((j) => j?.prompt)
            .map((j) => ({ description: j.description ?? "agent", prompt: j.prompt!, worktree: j.worktree }))
          const ids = jobs.length ? this.host.spawnAgents(jobs) : []
          const output = ids.length
            ? `Spawned ${ids.length} parallel agent(s):\n${ids.map((id, i) => `- ${id} — “${clip(jobs[i]!.description)}”`).join("\n")}\nCheck them with task_status / task_list.`
            : "No agents spawned (each job needs a prompt)."
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: output, isError: !ids.length })
          this.emit({ type: "tool-result", callId: tc.id, ok: !!ids.length, output, title: `spawn_agents ×${ids.length}` })
          continue
        }
        if (tc.name === SEND_TO_TASK) {
          const a = safeParse(tc.arguments) as { id?: string; text?: string }
          const ok = a.id && a.text ? this.host.sendToTask(a.id, a.text) : false
          const output = ok ? `Delivered to task ${a.id}.` : `Could not deliver to task ${a.id ?? "(missing id)"}.`
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: output, isError: !ok })
          this.emit({ type: "tool-result", callId: tc.id, ok, output, title: `send_to_task ${a.id ?? ""}` })
          continue
        }

        if (tc.name === MEMORY_TOOL) {
          const a = safeParse(tc.arguments) as { action?: string; name?: string; content?: string }
          let output: string
          if (a.action === "save" && a.name) {
            saveMemory(a.name, a.content ?? "")
            output = `Remembered “${a.name}”.`
          } else if (a.action === "delete" && a.name) {
            output = deleteMemory(a.name) ? `Forgot “${a.name}”.` : `No memory named “${a.name}”.`
          } else if (a.action === "list") {
            const facts = listMemory()
            output = facts.length ? facts.map((f) => `- ${f.name}`).join("\n") : "No memories saved."
          } else {
            output = "memory: provide action 'save' (with name+content), 'list', or 'delete' (with name)."
          }
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: output })
          this.emit({ type: "tool-result", callId: tc.id, ok: true, output, title: `memory ${a.action ?? ""}` })
          continue
        }

        if (tc.name === ENTER_WORKTREE) {
          const a = safeParse(tc.arguments) as { name?: string }
          const res = await this.enterWorktree((a.name ?? "work").trim())
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: res.info, isError: !res.ok })
          this.emit({
            type: "tool-result",
            callId: tc.id,
            ok: res.ok,
            output: res.info,
            title: `enter_worktree ${a.name ?? ""}`,
          })
          if (res.ok)
            this.emit({
              type: "notice",
              text: `⎇ entered worktree “${a.name}” — edits now run in an isolated checkout`,
            })
          continue
        }
        if (tc.name === EXIT_WORKTREE) {
          const res = this.exitWorktree()
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: res.info, isError: !res.ok })
          this.emit({ type: "tool-result", callId: tc.id, ok: res.ok, output: res.info, title: "exit_worktree" })
          if (res.ok) this.emit({ type: "notice", text: "⎇ left worktree — back on the main working directory" })
          continue
        }
        if (tc.name === WORKTREE_LIST) {
          const list = await gitWorktreeList(this.cwd)
          const output = list.length
            ? list.map((w) => `- ${w.branch || "(detached)"} — ${w.path}`).join("\n")
            : "No worktrees."
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: output })
          this.emit({ type: "tool-result", callId: tc.id, ok: true, output, title: "worktree_list" })
          continue
        }

        if (tc.name === CRON_CREATE) {
          const a = safeParse(tc.arguments) as { description?: string; prompt?: string; every?: string }
          const res = this.host.cronCreate(a.description ?? "task", a.prompt ?? "", a.every ?? "")
          const output = res.ok
            ? `Scheduled ${res.id} — “${clip(a.description ?? "")}” every ${a.every}.`
            : `Error: ${res.error}`
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: output, isError: !res.ok })
          this.emit({
            type: "tool-result",
            callId: tc.id,
            ok: res.ok,
            output,
            title: `cron_create: ${clip(a.description ?? "")}`,
          })
          continue
        }
        if (tc.name === CRON_LIST) {
          const jobs = this.host.cronList()
          const output = jobs.length
            ? jobs.map((j) => `- ${j.id} every ${Math.round(j.everyMs / 1000)}s — ${j.description}`).join("\n")
            : "No scheduled tasks."
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: output })
          this.emit({ type: "tool-result", callId: tc.id, ok: true, output, title: "cron_list" })
          continue
        }
        if (tc.name === CRON_DELETE) {
          const a = safeParse(tc.arguments) as { id?: string }
          this.host.cronDelete(a.id ?? "")
          const output = `Deleted schedule ${a.id}.`
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: output })
          this.emit({ type: "tool-result", callId: tc.id, ok: true, output, title: `cron_delete ${a.id ?? ""}` })
          continue
        }

        if (tc.name === SKILL_TOOL) {
          const a = safeParse(tc.arguments) as { name?: string }
          const skill = this.skills.find((s) => s.name === a.name)
          const output = skill
            ? skill.content
            : `Unknown skill: ${a.name}. Available: ${this.skills.map((s) => s.name).join(", ") || "(none)"}`
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: output, isError: !skill })
          this.emit({ type: "tool-result", callId: tc.id, ok: !!skill, output, title: `skill ${a.name ?? ""}` })
          continue
        }

        if (tc.name === TASK_TOOL) {
          const a = safeParse(tc.arguments) as { description?: string; prompt?: string; agent?: string }
          this.emit({ type: "mascot", state: "working" })
          this.emit({ type: "status", text: `Subagent · ${clip(a.description ?? "task")}` })
          const summary = await this.runSubagent(a.prompt ?? "", a.agent)
          void this.hook("SubagentStop", { tool_response: summary })
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: summary })
          this.emit({
            type: "tool-result",
            callId: tc.id,
            ok: true,
            output: summary,
            title: `task: ${a.description ?? "subagent"}`,
          })
          continue
        }

        if (tc.name === ASK_USER) {
          const a = safeParse(tc.arguments) as {
            question?: string
            header?: string
            art?: string
            options?: unknown
            questions?: { question?: string; header?: string; art?: string; options?: unknown; multi?: boolean }[]
          }
          const questions: AskQuestion[] =
            Array.isArray(a.questions) && a.questions.length
              ? a.questions.map((q, i) =>
                  toAskQuestion(`q${i}`, q.question ?? "", q.options, q.multi === true, q.header, q.art),
                )
              : [toAskQuestion("q0", a.question ?? "", a.options, false, a.header, a.art)]
          const requestId = this.host.nextId()
          this.emit({ type: "ask-user", requestId, questions })
          this.emit({ type: "mascot", state: "idle" })
          this.emit({ type: "status", text: "waiting for you…" })
          this.needsInput = true
          const answers = await new Promise<Record<string, string>>((resolve) =>
            this.pendingAsk.set(requestId, resolve),
          )
          const result = formatAskAnswers(questions, answers)
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result })
          this.emit({ type: "tool-result", callId: tc.id, ok: true, output: result })
          continue
        }

        if (LSP_TOOLS.has(tc.name)) {
          const output = await this.runLspTool(tc.name, safeParse(tc.arguments))
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: output })
          this.emit({ type: "tool-result", callId: tc.id, ok: true, output, title: tc.name })
          continue
        }

        const tool = registry.get(tc.name)
        if (!tool) {
          const msg = `Unknown tool: ${tc.name}`
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: msg, isError: true })
          this.emit({ type: "tool-result", callId: tc.id, ok: false, output: msg })
          continue
        }

        const parsed = tryParseArgs(tc.arguments)
        if (!parsed.ok) {
          // Truncated/corrupt streamed JSON — reject rather than run e.g. edit/write with empty input.
          const msg = `Tool ${tc.name} was not run: its arguments were not valid JSON. Re-issue the call with valid JSON.`
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: msg, isError: true })
          this.emit({ type: "tool-result", callId: tc.id, ok: false, output: msg })
          continue
        }
        let args = parsed.value

        // PreToolUse hook: may block the call or replace its input.
        const pre = await this.hook("PreToolUse", { tool_name: tc.name, tool_input: args }, tc.name)
        if (pre.block) {
          const msg = `Blocked by a PreToolUse hook${pre.reason ? `: ${pre.reason}` : "."}`
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: msg, isError: true })
          this.emit({ type: "tool-result", callId: tc.id, ok: false, output: msg })
          continue
        }
        if (pre.input !== undefined) args = pre.input

        const decision = await this.checkPermission(tool, args, sel.mode)
        if (decision === "deny") {
          const msg = `User denied permission to run ${tool.name}.`
          this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: msg, isError: true })
          this.emit({ type: "tool-result", callId: tc.id, ok: false, output: msg })
          continue
        }

        if (tool.permission === "edit" && this.currentCheckpoint) {
          const p = (args as any)?.path
          if (typeof p === "string") snapshotFile(this.currentCheckpoint, path.resolve(this.cwd, p))
        }
        // Bash can change files the checkpoint never saw (mv, codegen, npm writes). Record the set of
        // already-changed paths so we can diff after the command and snapshot whatever bash touched.
        let bashBefore: Set<string> | undefined
        if (tool.permission === "bash" && this.currentCheckpoint) {
          bashBefore = new Set((await gitStatus(this.cwd)).files.map((f) => f.path))
        }

        let result: ToolResult
        try {
          result = await tool.execute(args, { cwd: this.cwd, roots: this.roots, signal })
        } catch (e: any) {
          result = { output: `Error: ${e?.message ?? e}`, isError: true }
        }

        if (bashBefore) await this.snapshotBashChanges(bashBefore)

        // Auto-format the touched file, then ground the edit in real compiler output (diagnostics).
        if (tool.permission === "edit" && !result.isError && typeof (args as any)?.path === "string") {
          const abs = path.resolve(this.cwd, (args as any).path)
          await formatFile(this.cwd, abs, this.host.formatterEnabled())
          const diag = await this.diagnoseEdited(abs)
          if (diag) result = { ...result, output: result.output + diag }
        }

        void this.hook("PostToolUse", { tool_name: tc.name, tool_input: args, tool_response: result.output }, tc.name)
        this.addMessage({ role: "tool", callId: tc.id, name: tc.name, result: result.output, isError: result.isError })
        this.emit({
          type: "tool-result",
          callId: tc.id,
          ok: !result.isError,
          output: result.output,
          title: result.title,
          diff: result.diff,
        })
      }
    }
    // Fell out of the loop without finishing → the step budget ran out mid-task. Tell the user so
    // it doesn't look like work silently stopped; the `finally` in runPrompt finalizes the bubble.
    if (!this.abort?.signal.aborted) {
      this.emit({
        type: "notice",
        text: `Reached the ${MAX_STEPS}-step limit — stopping. Ask me to continue if needed.`,
      })
    }
  }

  private async runSubagent(prompt: string, agent?: string): Promise<string> {
    const sel = this.host.selection()
    const provider = this.host.resolveProvider()
    const apiKey = getProviderKey(provider.id)
    const signal = this.abort!.signal
    // A custom agent type (.friday/agents/<name>.md) can supply its own prompt, model and
    // a narrowed tool allowlist. Sub-agents stay read-only — a custom `tools` list can only
    // pick from the read-only set, never escalate to edit/bash (which have no nested UI gate).
    const def = agent ? this.agents.find((a) => a.name === agent) : undefined
    let tools = this.host
      .registry()
      .list.filter(
        (t) =>
          t.permission === "read" &&
          t.name !== SKILL_TOOL &&
          t.name !== TASK_TOOL &&
          t.name !== ASK_USER &&
          t.name !== TODO_WRITE &&
          !LSP_TOOLS.has(t.name),
      )
    if (def?.tools?.length) tools = tools.filter((t) => def.tools!.includes(t.name))
    const defs = tools.map(toToolDef)
    const get = (n: string) => tools.find((t) => t.name === n)
    const model = def?.model ?? sel.model!
    const messages: Message[] = [
      { role: "system", text: def ? customAgentPrompt(def.content, this.cwd) : subagentPrompt(agent, this.cwd) },
      { role: "user", text: prompt },
    ]
    let lastText = ""

    for (let step = 0; step < 15; step++) {
      if (signal.aborted) break
      const { text, reasoning, reasoningSignature, toolCalls } = await this.collectTurn(
        this.host.streamFn(
          provider,
          apiKey,
          { model, messages, tools: defs, effort: sel.reasoning ? sel.effort : undefined, maxTokens: 4096 },
          signal,
        ),
        signal,
        { usage: (i, o) => (this.totalTokens += i + o) },
      )
      messages.push({
        role: "assistant",
        text: text || undefined,
        reasoning: reasoning || undefined,
        reasoningSignature: reasoningSignature || undefined,
        toolCalls: toolCalls.length ? toolCalls : undefined,
      })
      if (text) lastText = text
      if (!toolCalls.length) return lastText || "(no result)"

      for (const tc of toolCalls) {
        const tool = get(tc.name)
        let result: ToolResult
        if (!tool) {
          result = { output: `Unknown or disallowed tool for a sub-agent: ${tc.name}`, isError: true }
        } else {
          let args = safeParse(tc.arguments)
          // Sub-agent tool calls go through the same PreToolUse/PostToolUse hooks as the
          // main loop, so security gates apply uniformly.
          const pre = await this.hook("PreToolUse", { tool_name: tc.name, tool_input: args }, tc.name)
          if (pre.block) {
            result = { output: `Blocked by a PreToolUse hook${pre.reason ? `: ${pre.reason}` : "."}`, isError: true }
          } else {
            if (pre.input !== undefined) args = pre.input
            try {
              result = await tool.execute(args, { cwd: this.cwd, roots: this.roots, signal })
            } catch (e: any) {
              result = { output: `Error: ${e?.message ?? e}`, isError: true }
            }
            void this.hook(
              "PostToolUse",
              { tool_name: tc.name, tool_input: args, tool_response: result.output },
              tc.name,
            )
          }
        }
        messages.push({ role: "tool", callId: tc.id, name: tc.name, result: result.output, isError: result.isError })
      }
    }
    return lastText || "(subagent reached its step limit)"
  }

  // ---- LSP grounding ----
  private rel(p: string): string {
    const r = path.relative(this.cwd, p)
    return r && !r.startsWith("..") ? r : p
  }

  /** Resolve bare `@Symbol` mentions (no slash/dot) to workspace symbol locations. */
  private async augmentSymbols(original: string, expanded: string, files: string[]): Promise<string> {
    const tokens = [...original.matchAll(/(?:^|\s)@([A-Za-z_][A-Za-z0-9_]+)(?![/.])/g)]
      .map((m) => m[1]!)
      .filter((t) => !files.includes(t))
    const uniq = [...new Set(tokens)].slice(0, 3)
    if (!uniq.length) return expanded
    const blocks: string[] = []
    for (const t of uniq) {
      const hits = await this.lsp.workspaceSymbols(t).catch(() => [])
      if (hits.length)
        blocks.push(
          `<symbol name="${t}">\n${hits.map((h) => `${h.name} — ${this.rel(h.path)}:${h.line}`).join("\n")}\n</symbol>`,
        )
    }
    return blocks.length ? `${expanded}\n\n${blocks.join("\n\n")}` : expanded
  }

  private async diagnoseEdited(file: string): Promise<string> {
    try {
      const diags = await this.lsp.diagnose(file)
      const errors = diags.filter((d) => d.severity === 1).length
      const warnings = diags.filter((d) => d.severity === 2).length
      if (errors || warnings) this.diag.set(file, { errors, warnings })
      else this.diag.delete(file)
      this.emit({
        type: "diagnostics",
        items: [...this.diag.entries()].map(([p, v]) => ({
          path: this.rel(p),
          errors: v.errors,
          warnings: v.warnings,
        })),
      })
      return formatDiagnostics(file, diags)
    } catch {
      return ""
    }
  }

  private async runLspTool(name: string, args: unknown): Promise<string> {
    const a = args as { path?: string; line?: number; character?: number; query?: string }
    const file = a.path ? path.resolve(this.cwd, a.path) : undefined
    if (name === LSP_HOVER) {
      if (!file) return "lsp_hover needs a path."
      return (
        (await this.lsp.hover(file, (a.line ?? 1) - 1, (a.character ?? 1) - 1)) ??
        "No hover info (no language server, or nothing there)."
      )
    }
    if (name === LSP_DEFINITION) {
      if (!file) return "lsp_definition needs a path."
      const defs = await this.lsp.definition(file, (a.line ?? 1) - 1, (a.character ?? 1) - 1)
      return defs.length ? defs.map((d) => this.rel(d)).join("\n") : "No definition found (or no language server)."
    }
    if (name === LSP_SYMBOLS) {
      if (a.query) {
        const syms = await this.lsp.workspaceSymbols(a.query, file ?? "x.ts")
        return syms.length
          ? syms.map((s) => `${s.name} — ${this.rel(s.path)}:${s.line}`).join("\n")
          : "No matching symbols (or no language server)."
      }
      if (file) {
        const syms = await this.lsp.documentSymbols(file)
        return syms.length ? syms.join("\n") : "No symbols (or no language server)."
      }
      return "lsp_symbols needs `query` or `path`."
    }
    return "Unknown LSP tool."
  }

  private async checkPermission(tool: Tool, args: unknown, mode: ModeId): Promise<"allow" | "deny"> {
    const cat = tool.permission
    if (cat === "read") return "allow"
    const command = typeof (args as any)?.command === "string" ? ((args as any).command as string) : undefined

    // bash allow/deny lists take precedence over the mode policy.
    if (cat === "bash" && command) {
      const policy = this.host.bashPolicy()
      if (matchesList(command, policy?.deny)) return "deny"
      if (matchesList(command, policy?.allow)) return "allow"
    }
    if (this.sessionAllow.has(cat)) return "allow"
    // Per-project rules the user previously chose to "always allow".
    const proj = this.host.projectPermissions(this.roots[0] ?? this.cwd)
    if (cat === "bash" && command) {
      if (matchesList(command, proj.bash)) return "allow"
    } else if (proj.categories?.includes(cat)) return "allow"
    const verdict = getMode(mode).policy[cat]
    if (verdict === "allow") return "allow"
    if (verdict === "deny") return "deny"

    const requestId = this.host.nextId()
    const detail =
      command ??
      (typeof (args as any)?.path === "string" ? String((args as any).path) : JSON.stringify(args).slice(0, 120))
    const risk = command ? bashRisk(command) : undefined
    this.emit({ type: "permission-request", requestId, tool: tool.name, summary: `Allow ${tool.name}?`, detail, risk })
    this.emit({ type: "mascot", state: "idle" })
    this.emit({ type: "status", text: "waiting for you…" })
    this.needsInput = true
    void this.hook("Notification", { message: `${tool.name} needs approval` })
    return new Promise<"allow" | "deny">((resolve) => this.pending.set(requestId, { resolve, category: cat, command }))
  }

  // ---- /commit ----
  async commitFlow(): Promise<void> {
    const status = await gitStatus(this.cwd)
    if (!status.repo) return this.emit({ type: "error", message: "Not a git repository." })
    if (!status.dirty) return this.emit({ type: "status", text: "nothing to commit — working tree clean" })

    this.emit({ type: "mascot", state: "working" })
    this.emit({ type: "status", text: "drafting commit message…" })
    const drafted = await this.draftCommit(await gitDiff(this.cwd))

    const requestId = this.host.nextId()
    this.emit({
      type: "ask-user",
      requestId,
      questions: [{ id: "q0", question: `Commit message (Enter to accept, or type your own):\n\n${drafted}` }],
    })
    this.needsInput = true
    const answers = await new Promise<Record<string, string>>((resolve) => this.pendingAsk.set(requestId, resolve))
    this.needsInput = this.pending.size > 0 || this.pendingAsk.size > 0
    const answer = answers.q0
    const message = answer && answer !== "(no answer)" ? answer : drafted

    const res = await gitCommitAll(this.cwd, message)
    this.emit({ type: "mascot", state: "idle" })
    if (res.ok) {
      this.emit({ type: "notice", text: `✓ committed ${res.info} — ${message}` })
      this.emitSessionFiles()
    } else {
      this.emit({ type: "error", message: `Commit failed: ${res.info}` })
    }
    this.emit({ type: "status", text: "ready" })
  }

  private async draftCommit(diff: string): Promise<string> {
    const sel = this.host.selection()
    if (!sel.model || !diff.trim()) return "Update files"
    const provider = this.host.resolveProvider()
    const apiKey = getProviderKey(provider.id)
    const req = {
      model: sel.model,
      messages: [
        {
          role: "system",
          text: "Write ONE concise git commit subject line in conventional-commits style (type(scope): summary), imperative mood, under 72 chars. Output only the line.",
        } as Message,
        { role: "user", text: `Diff:\n${diff}` } as Message,
      ],
      tools: [],
      maxTokens: 80,
    }
    let text = ""
    try {
      for await (const ev of this.host.streamFn(provider, apiKey, req, new AbortController().signal))
        if (ev.type === "text") text += ev.delta
    } catch {
      return "Update files"
    }
    return text.trim().split("\n")[0] || "Update files"
  }
}
