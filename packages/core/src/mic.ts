import fs from "node:fs"
import os from "node:os"
import path from "node:path"

/**
 * Local speech-to-text (mic). Records the mic with whatever recorder is installed (ffmpeg / sox /
 * arecord) to a 16 kHz mono WAV, then transcribes ON-DEVICE with whisper-tiny.en via Transformers.js
 * (onnxruntime). No API key, no cloud, nothing native to compile: the ~40 MB model is downloaded once
 * and cached under ~/.friday/models, then it works offline.
 *
 * Interaction is press-to-talk (start, then stop) — robust in a terminal and bug-free vs key-repeat.
 */

export type MicConfig = {
  /** override the recorder binary (sox `rec` / ffmpeg / arecord) */
  recorder?: string
  /** transcription model id (default Xenova/whisper-tiny.en) */
  model?: string
}

const DEFAULT_MODEL = "Xenova/whisper-tiny.en"
function modelsDir(): string {
  return path.join(os.homedir(), ".friday", "models")
}

type Recorder = { bin: string; argv: (out: string) => string[] }

/** An available mic input the user can pick. `id` is what the recorder backend expects. */
export type InputDevice = { id: string; label: string }

/**
 * Find an installed mic recorder, configured to capture 16 kHz mono WAV (what Whisper wants).
 * `device` (optional) is a backend-specific input id from listInputDevices(); falls back to default.
 */
function findRecorder(override?: string, device?: string): Recorder | undefined {
  if (override && Bun.which(override.split(" ")[0]!)) {
    const parts = override.split(" ")
    return { bin: parts[0]!, argv: (out) => [...parts, out] }
  }
  // sox rec/sox: capture the default input (device selection not wired — uncommon in practice)
  if (Bun.which("rec")) return { bin: "rec", argv: (o) => ["rec", "-q", "-r", "16000", "-c", "1", o] } // sox
  if (Bun.which("sox")) return { bin: "sox", argv: (o) => ["sox", "-d", "-q", "-r", "16000", "-c", "1", o] }
  if (process.platform === "linux" && Bun.which("arecord")) {
    const dflags = device ? ["-D", device] : []
    return {
      bin: "arecord",
      argv: (o) => ["arecord", "-q", ...dflags, "-f", "S16_LE", "-r", "16000", "-c", "1", "-t", "wav", o],
    }
  }
  if (Bun.which("ffmpeg")) {
    const dev =
      process.platform === "darwin"
        ? ["-f", "avfoundation", "-i", `:${device ?? "0"}`] // avfoundation audio index, e.g. :0
        : process.platform === "win32"
          ? ["-f", "dshow", "-i", `audio=${device ?? "default"}`]
          : ["-f", "alsa", "-i", device ?? "default"]
    return { bin: "ffmpeg", argv: (o) => ["ffmpeg", "-y", "-loglevel", "quiet", ...dev, "-ar", "16000", "-ac", "1", o] }
  }
  return undefined
}

/**
 * Enumerate selectable mic inputs. macOS: parse ffmpeg's avfoundation device list; Linux: parse
 * `arecord -l` cards. Anything else (or a parse miss) → a single "default" entry.
 * ponytail: parse only what we need; the default entry always works, so a flaky parse just hides names.
 */
export function listInputDevices(): InputDevice[] {
  const fallback: InputDevice[] = [{ id: process.platform === "darwin" ? "0" : "default", label: "default" }]
  try {
    if (process.platform === "darwin" && Bun.which("ffmpeg")) {
      // ffmpeg prints the device list to stderr then errors out (empty input) — that's expected.
      const r = Bun.spawnSync(["ffmpeg", "-f", "avfoundation", "-list_devices", "true", "-i", ""], {
        stdout: "ignore",
        stderr: "pipe",
      })
      const text = r.stderr.toString()
      const out: InputDevice[] = []
      let inAudio = false
      for (const line of text.split("\n")) {
        if (/AVFoundation audio devices:/.test(line)) inAudio = true
        else if (/AVFoundation video devices:/.test(line)) inAudio = false
        else if (inAudio) {
          const m = line.match(/\[(\d+)\]\s+(.+?)\s*$/)
          if (m) out.push({ id: m[1]!, label: m[2]! })
        }
      }
      return out.length ? out : fallback
    }
    if (process.platform === "linux" && Bun.which("arecord")) {
      const r = Bun.spawnSync(["arecord", "-l"], { stdout: "pipe", stderr: "ignore" })
      const out: InputDevice[] = []
      for (const line of r.stdout.toString().split("\n")) {
        const m = line.match(/^card (\d+):\s+\S+\s+\[([^\]]+)\].*device (\d+):/)
        if (m) out.push({ id: `hw:${m[1]},${m[3]}`, label: m[2]! })
      }
      return out.length ? out : fallback
    }
  } catch {}
  return fallback
}

/** Decode a 16-bit PCM WAV file to mono Float32 in [-1,1] (first channel if stereo). */
export function decodeWav(file: string): Float32Array | undefined {
  const buf = fs.readFileSync(file)
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF") return undefined
  let off = 12
  let dataOff = -1
  let dataLen = 0
  let bits = 16
  let channels = 1
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4)
    const sz = buf.readUInt32LE(off + 4)
    if (id === "fmt ") {
      channels = buf.readUInt16LE(off + 10) || 1
      bits = buf.readUInt16LE(off + 22) || 16
    } else if (id === "data") {
      dataOff = off + 8
      dataLen = sz
      break
    }
    off += 8 + sz + (sz & 1)
  }
  if (dataOff < 0 || bits !== 16) return undefined // recorders emit 16-bit PCM; bail otherwise
  // While still recording the data-chunk size is a placeholder (0 or huge); use what's on disk so
  // partial WAVs decode for live transcription.
  if (!dataLen || dataLen > buf.length - dataOff) dataLen = buf.length - dataOff
  const samples = dataLen >> 1
  const out = new Float32Array(Math.ceil(samples / channels))
  let j = 0
  for (let i = 0; i < samples; i += channels) out[j++] = buf.readInt16LE(dataOff + i * 2) / 32768
  return out
}

// ---- on-device whisper (Transformers.js), lazily loaded ----

let asrPromise: Promise<(input: Float32Array) => Promise<{ text: string }>> | undefined
async function getAsr(model: string): Promise<(input: Float32Array) => Promise<{ text: string }>> {
  if (!asrPromise) {
    asrPromise = (async () => {
      // dynamic import so the heavy dep never slows startup and a broken install fails gracefully
      const { env, pipeline } = await import("@huggingface/transformers")
      env.cacheDir = modelsDir()
      env.allowLocalModels = false
      const asr = await pipeline("automatic-speech-recognition", model)
      return (input: Float32Array) => asr(input) as Promise<{ text: string }>
    })()
    asrPromise.catch(() => {
      asrPromise = undefined // let a failed load retry next time
    })
  }
  return asrPromise
}

/** Kick off the model download/load in the background (called when recording starts). */
export function prewarmMic(cfg?: MicConfig): void {
  void getAsr(cfg?.model ?? DEFAULT_MODEL).catch(() => {})
}

class MicSession {
  private proc?: ReturnType<typeof Bun.spawn>
  private out?: string
  private partialBusy = false
  private lastPartial = ""
  recording = false

  start(cfg?: MicConfig, device?: string): void {
    if (this.recording) return
    const rec = findRecorder(cfg?.recorder, device)
    if (!rec) throw new Error("no microphone recorder found — install ffmpeg or sox")
    this.out = path.join(os.tmpdir(), `friday-mic-${process.pid}.wav`)
    this.lastPartial = ""
    this.proc = Bun.spawn(rec.argv(this.out), { stdout: "ignore", stderr: "ignore" })
    this.recording = true
    prewarmMic(cfg) // start loading the model while the user talks
  }

  /**
   * Transcribe whatever's been captured so far WITHOUT stopping — for the live preview. Returns the
   * last result while a previous pass is still running (no overlap) or before the model is ready.
   */
  async transcribePartial(cfg?: MicConfig): Promise<string> {
    if (!this.recording || !this.out || this.partialBusy) return this.lastPartial
    if (!asrPromise) return this.lastPartial // model not loaded yet — wait for prewarm
    this.partialBusy = true
    try {
      const audio = decodeWav(this.out)
      if (!audio || audio.length < 1600) return this.lastPartial
      const asr = await getAsr(cfg?.model ?? DEFAULT_MODEL)
      const r = await asr(audio)
      this.lastPartial = (r?.text ?? "").trim()
    } catch {
      // partial decode/transcribe is best-effort; keep the last good text
    } finally {
      this.partialBusy = false
    }
    return this.lastPartial
  }

  /** Stop capture, transcribe locally, return recognized text ("" if nothing heard). */
  async stopAndTranscribe(cfg?: MicConfig): Promise<string> {
    if (!this.recording || !this.out || !this.proc) return ""
    this.recording = false
    this.proc.kill("SIGINT") // flush a valid WAV header
    await this.proc.exited.catch(() => {})
    await Bun.sleep(150)
    const wav = this.out
    this.out = undefined
    this.proc = undefined
    if (!fs.existsSync(wav) || fs.statSync(wav).size < 1024) return ""
    try {
      const audio = decodeWav(wav)
      if (!audio || audio.length < 1600) return "" // < 0.1s captured
      const asr = await getAsr(cfg?.model ?? DEFAULT_MODEL)
      const r = await asr(audio)
      return (r?.text ?? "").trim()
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
    if (this.out)
      try {
        fs.unlinkSync(this.out)
      } catch {}
    this.recording = false
    this.proc = undefined
    this.out = undefined
  }
}

let session: MicSession | undefined
function active(): MicSession {
  if (!session) session = new MicSession()
  return session
}

export function micRecording(): boolean {
  return active().recording
}
export function startMic(cfg?: MicConfig, device?: string): void {
  active().start(cfg, device)
}
export function transcribePartial(cfg?: MicConfig): Promise<string> {
  return active().transcribePartial(cfg)
}
export function stopMic(cfg?: MicConfig): Promise<string> {
  return active().stopAndTranscribe(cfg)
}
export function cancelMic(): void {
  session?.cancel()
}

export function micStatus(cfg?: MicConfig): { ok: boolean; reason: string } {
  if (!findRecorder(cfg?.recorder)) return { ok: false, reason: "no mic recorder (install ffmpeg or sox)" }
  return { ok: true, reason: "ready (on-device whisper-tiny.en)" }
}

/**
 * Setup checklist for the mic modal. Each line is prefixed ✓ (done) or • (todo). The model line is
 * informational — it downloads itself on first use.
 */
export function micSetupSteps(cfg?: MicConfig): { ready: boolean; lines: string[] } {
  const ok = (done: boolean, text: string) => `${done ? "✓" : "•"} ${text}`
  const hasRec = !!findRecorder(cfg?.recorder)
  const recHint =
    process.platform === "darwin"
      ? "brew install ffmpeg   (or sox)"
      : process.platform === "win32"
        ? "install ffmpeg and add it to PATH"
        : "sudo apt install ffmpeg   (or sox / alsa-utils)"
  return {
    ready: hasRec,
    lines: [
      "Local speech-to-text — runs on your machine, no API key, no cloud:",
      ok(hasRec, `Install a mic recorder: ${recHint}`),
      "• First run downloads whisper-tiny.en (~40MB) once, then works offline",
      "• Your OS will ask for Microphone permission the first time — allow it",
      "Then press Ctrl+R, speak, and press Ctrl+R again to transcribe & insert.",
    ],
  }
}
