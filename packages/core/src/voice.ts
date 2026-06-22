import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { getProviderKey } from "@friday/providers"

/**
 * Voice input (speech-to-text only — no TTS, no bundled model). The design goal is "use what's on
 * the device": capture the mic with whatever recorder is installed, then transcribe with an OS-native
 * engine when one exists, else a cloud Whisper endpoint if a key is set, else say so plainly.
 *
 * HONEST LIMIT: there is no reliable cross-platform *native* CLI speech-to-text. Windows has SAPI,
 * macOS/Linux have nothing built in for this. So in practice cloud Whisper (Groq/OpenAI — both expose
 * an OpenAI-compatible /audio/transcriptions endpoint) is the realistic default for most users. We
 * never bundle or auto-install a model.
 *
 * Interaction is press-to-talk (start, then stop), NOT hold-to-talk — that avoids fragile key-repeat
 * handling in the terminal and is far less bug-prone.
 */

export type VoiceConfig = {
  /** "auto" (native→cloud), "groq", "openai", or "native" */
  engine?: "auto" | "groq" | "openai" | "native"
  /** override the recorder binary (sox `rec` / ffmpeg / arecord) */
  recorder?: string
  /** transcription model (defaults: groq=whisper-large-v3-turbo, openai=whisper-1) */
  model?: string
}

type Recorder = { bin: string; argv: (out: string) => string[] }

/** Find an installed mic recorder. `rec` (sox) is the simplest cross-platform; arecord on Linux. */
function findRecorder(override?: string): Recorder | undefined {
  if (override && Bun.which(override.split(" ")[0]!)) {
    const parts = override.split(" ")
    return { bin: parts[0]!, argv: (out) => [...parts, out] }
  }
  if (Bun.which("rec")) return { bin: "rec", argv: (out) => ["rec", "-q", out] } // sox
  if (Bun.which("sox")) return { bin: "sox", argv: (out) => ["sox", "-d", "-q", out] }
  if (process.platform === "linux" && Bun.which("arecord"))
    return { bin: "arecord", argv: (out) => ["arecord", "-q", "-f", "cd", "-t", "wav", out] }
  if (Bun.which("ffmpeg")) {
    const dev = process.platform === "darwin" ? ["-f", "avfoundation", "-i", ":0"] : ["-f", "alsa", "-i", "default"]
    return { bin: "ffmpeg", argv: (out) => ["ffmpeg", "-y", "-loglevel", "quiet", ...dev, out] }
  }
  return undefined
}

class VoiceSession {
  private proc?: ReturnType<typeof Bun.spawn>
  private out?: string
  recording = false

  /** Begin capturing the mic to a temp WAV. Throws if no recorder is installed. */
  start(cfg?: VoiceConfig): void {
    if (this.recording) return
    const rec = findRecorder(cfg?.recorder)
    if (!rec) throw new Error("no microphone recorder found — install sox (`rec`), ffmpeg, or arecord")
    this.out = path.join(os.tmpdir(), `friday-voice-${process.pid}-${this.proc ? 1 : 0}.wav`)
    this.proc = Bun.spawn(rec.argv(this.out), { stdout: "ignore", stderr: "ignore" })
    this.recording = true
  }

  /** Stop capturing, transcribe, and return the recognized text (empty string if nothing heard). */
  async stopAndTranscribe(cfg?: VoiceConfig): Promise<string> {
    if (!this.recording || !this.out || !this.proc) return ""
    this.recording = false
    this.proc.kill("SIGINT") // let the recorder flush a valid WAV header
    await this.proc.exited.catch(() => {})
    await Bun.sleep(150)
    const wav = this.out
    this.out = undefined
    this.proc = undefined
    if (!fs.existsSync(wav) || fs.statSync(wav).size < 1024) return ""
    try {
      return await transcribe(wav, cfg)
    } finally {
      try {
        fs.unlinkSync(wav)
      } catch {}
    }
  }

  cancel(): void {
    try {
      this.proc?.kill()
    } catch {}
    if (this.out) {
      try {
        fs.unlinkSync(this.out)
      } catch {}
    }
    this.recording = false
    this.proc = undefined
    this.out = undefined
  }
}

let session: VoiceSession | undefined
function active(): VoiceSession {
  if (!session) session = new VoiceSession()
  return session
}

/** Pick a transcription backend given config + available keys. */
function resolveEngine(cfg?: VoiceConfig): { kind: "groq" | "openai"; key: string; model: string } | { kind: "none" } {
  const want = cfg?.engine ?? "auto"
  const groqKey = getProviderKey("groq")
  const openaiKey = getProviderKey("openai")
  if ((want === "groq" || want === "auto") && groqKey)
    return { kind: "groq", key: groqKey, model: cfg?.model ?? "whisper-large-v3-turbo" }
  if ((want === "openai" || want === "auto") && openaiKey)
    return { kind: "openai", key: openaiKey, model: cfg?.model ?? "whisper-1" }
  return { kind: "none" }
}

async function transcribe(wav: string, cfg?: VoiceConfig): Promise<string> {
  const eng = resolveEngine(cfg)
  if (eng.kind === "none")
    throw new Error("no speech engine available — set a GROQ_API_KEY or OPENAI_API_KEY (no native STT on this OS)")
  const url =
    eng.kind === "groq"
      ? "https://api.groq.com/openai/v1/audio/transcriptions"
      : "https://api.openai.com/v1/audio/transcriptions"
  const form = new FormData()
  form.append("file", new Blob([fs.readFileSync(wav)]), "audio.wav")
  form.append("model", eng.model)
  form.append("response_format", "text")
  const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${eng.key}` }, body: form })
  if (!res.ok) throw new Error(`transcription failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
  return (await res.text()).trim()
}

// ---- public API used by the engine / TUI -------------------------------

/** Is voice usable at all on this machine right now? (recorder present AND an engine resolvable) */
export function voiceStatus(cfg?: VoiceConfig): { ok: boolean; reason: string } {
  if (!findRecorder(cfg?.recorder))
    return { ok: false, reason: "no mic recorder (install sox `rec`, ffmpeg, or arecord)" }
  if (resolveEngine(cfg).kind === "none")
    return { ok: false, reason: "no speech engine (set GROQ_API_KEY or OPENAI_API_KEY)" }
  return { ok: true, reason: "ready" }
}

export function voiceRecording(): boolean {
  return active().recording
}

export function startVoice(cfg?: VoiceConfig): void {
  active().start(cfg)
}

export async function stopVoice(cfg?: VoiceConfig): Promise<string> {
  return active().stopAndTranscribe(cfg)
}

export function cancelVoice(): void {
  session?.cancel()
}
