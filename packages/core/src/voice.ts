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

// ---- native live transcription (macOS Speech framework) -----------------

/**
 * A tiny Swift CLI using SFSpeechRecognizer + AVAudioEngine that streams partial results as JSON
 * lines. It uses the OS speech engine (on-device when supported) so there is NOTHING to bundle —
 * we compile it on first use with swiftc and cache the binary in ~/.friday/bin.
 */
const SWIFT_SRC = `import Foundation
import Speech
import AVFoundation

func emit(_ obj: [String: Any]) {
    if let d = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: d, encoding: .utf8) {
        print(s); fflush(stdout)
    }
}

guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")), recognizer.isAvailable else {
    emit(["error": "speech recognizer unavailable"]); exit(1)
}
let audioEngine = AVAudioEngine()
var request: SFSpeechAudioBufferRecognitionRequest?
var task: SFSpeechRecognitionTask?

func startListening() {
    let req = SFSpeechAudioBufferRecognitionRequest()
    req.shouldReportPartialResults = true
    if recognizer.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
    request = req
    let input = audioEngine.inputNode
    let format = input.outputFormat(forBus: 0)
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in req.append(buffer) }
    audioEngine.prepare()
    do { try audioEngine.start() } catch { emit(["error": "audio start failed"]); exit(1) }
    emit(["ready": true])
    task = recognizer.recognitionTask(with: req) { result, error in
        if let result = result {
            let text = result.bestTranscription.formattedString
            emit(result.isFinal ? ["final": text] : ["partial": text])
        }
        if error != nil { /* surfaced via parent timeout/last-partial */ }
    }
}

func stopListening() {
    audioEngine.stop()
    audioEngine.inputNode.removeTap(onBus: 0)
    request?.endAudio()
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { task?.cancel(); exit(0) }
}

SFSpeechRecognizer.requestAuthorization { status in
    DispatchQueue.main.async {
        guard status == .authorized else { emit(["error": "speech not authorized"]); exit(2) }
        startListening()
    }
}
FileHandle.standardInput.readabilityHandler = { _ in DispatchQueue.main.async { stopListening() } }
RunLoop.main.run()
`

function helperBin(): string {
  return path.join(os.homedir(), ".friday", "bin", "friday-speech")
}

/** Compile the Swift helper once (cached). Returns its path, or undefined if not buildable here. */
function ensureSpeechHelper(): string | undefined {
  if (process.platform !== "darwin") return undefined
  const bin = helperBin()
  if (fs.existsSync(bin)) return bin
  if (!Bun.which("swiftc")) return undefined
  try {
    fs.mkdirSync(path.dirname(bin), { recursive: true })
    const src = `${bin}.swift`
    fs.writeFileSync(src, SWIFT_SRC)
    const p = Bun.spawnSync(["swiftc", src, "-o", bin, "-framework", "Speech", "-framework", "AVFoundation"], {
      stdout: "ignore",
      stderr: "ignore",
    })
    return p.success && fs.existsSync(bin) ? bin : undefined
  } catch {
    return undefined
  }
}

export function nativeLiveAvailable(): boolean {
  return process.platform === "darwin" && (fs.existsSync(helperBin()) || !!Bun.which("swiftc"))
}

/** Map a raw helper error token to actionable, human-readable guidance. */
function explainVoiceError(raw: string): string {
  const e = raw.toLowerCase()
  if (e.includes("not authorized") || e.includes("authoriz"))
    return "mic/Speech not authorized — enable your terminal app in System Settings → Privacy & Security → Microphone AND → Speech Recognition, then retry"
  if (e.includes("recognizer unavailable")) return "speech recognizer unavailable on this Mac"
  if (e.includes("audio start")) return "could not start the microphone (another app may be using it)"
  return raw.trim() || "voice helper exited unexpectedly"
}

class LiveVoiceSession {
  private proc?: ReturnType<typeof Bun.spawn>
  private last = ""
  private final?: string
  private gotResult = false
  running = false

  async start(onPartial: (text: string) => void, onError?: (msg: string) => void): Promise<void> {
    if (this.running) return
    const bin = ensureSpeechHelper()
    if (!bin) throw new Error("native speech unavailable (needs macOS + Xcode `swiftc`)")
    this.proc = Bun.spawn([bin], { stdin: "pipe", stdout: "pipe", stderr: "pipe" })
    this.running = true
    this.gotResult = false
    void this.readLoop(onPartial, onError)
  }

  private async readLoop(onPartial: (text: string) => void, onError?: (msg: string) => void): Promise<void> {
    if (!this.proc?.stdout) return
    const decoder = new TextDecoder()
    let buf = ""
    try {
      for await (const chunk of this.proc.stdout as ReadableStream<Uint8Array>) {
        buf += decoder.decode(chunk, { stream: true })
        const lines = buf.split("\n")
        buf = lines.pop() ?? ""
        for (const line of lines) {
          if (!line.trim()) continue
          let msg: any
          try {
            msg = JSON.parse(line)
          } catch {
            continue
          }
          if (typeof msg.partial === "string") {
            this.gotResult = true
            this.last = msg.partial
            onPartial(msg.partial)
          } else if (typeof msg.final === "string") {
            this.gotResult = true
            this.final = msg.final
            onPartial(msg.final)
          } else if (msg.error) {
            this.final = this.final ?? ""
            onError?.(explainVoiceError(String(msg.error)))
          }
        }
      }
    } catch (e: any) {
      onError?.(explainVoiceError(String(e?.message ?? e)))
    }
    // Stream closed with no transcript and no error reported → surface stderr / exit reason.
    if (!this.gotResult && this.running) {
      let err = ""
      try {
        const se = this.proc?.stderr
        if (se && typeof se !== "number") err = await new Response(se as ReadableStream<Uint8Array>).text()
      } catch {}
      onError?.(explainVoiceError(err))
    }
  }

  async stop(): Promise<string> {
    if (!this.running || !this.proc) return ""
    this.running = false
    try {
      const sink = this.proc.stdin // FileSink when stdin:"pipe"
      if (sink && typeof sink !== "number") {
        sink.write("\n")
        sink.flush?.()
      }
    } catch {}
    await Promise.race([this.proc.exited, Bun.sleep(2500)])
    try {
      this.proc.kill()
    } catch {}
    const text = (this.final ?? this.last).trim()
    this.proc = undefined
    this.final = undefined
    this.last = ""
    return text
  }
}

let live: LiveVoiceSession | undefined
export function liveRecording(): boolean {
  return !!live?.running
}
export async function startLiveVoice(
  onPartial: (text: string) => void,
  onError?: (msg: string) => void,
): Promise<void> {
  if (!live) live = new LiveVoiceSession()
  await live.start(onPartial, onError)
}
export async function stopLiveVoice(): Promise<string> {
  return live ? live.stop() : ""
}

// ---- public API used by the engine / TUI -------------------------------

/** Is voice usable at all right now? Native live (macOS) needs nothing; batch needs recorder+key. */
export function voiceStatus(cfg?: VoiceConfig): { ok: boolean; reason: string } {
  if (nativeLiveAvailable()) return { ok: true, reason: "ready (native live transcription)" }
  if (!findRecorder(cfg?.recorder))
    return { ok: false, reason: "no mic recorder (install sox `rec`, ffmpeg, or arecord)" }
  if (resolveEngine(cfg).kind === "none")
    return { ok: false, reason: "no speech engine (set GROQ_API_KEY or OPENAI_API_KEY)" }
  return { ok: true, reason: "ready (cloud Whisper)" }
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
