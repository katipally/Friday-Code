import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { collectImages, expandMentions, isImagePath } from "../src/mentions.ts"

test("isImagePath recognizes image extensions", () => {
  expect(isImagePath("a/b/shot.png")).toBe(true)
  expect(isImagePath("photo.JPEG")).toBe(true)
  expect(isImagePath("notes.md")).toBe(false)
})

test("image mentions are attached as base64, not inlined as text", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "friday-img-"))
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
  fs.writeFileSync(path.join(dir, "shot.png"), png)
  fs.writeFileSync(path.join(dir, "readme.txt"), "hello world")

  const prompt = "look at @shot.png and @readme.txt"
  const { text } = expandMentions(prompt, [dir])
  // The text file is inlined; the image is NOT (no binary garbage in the prompt).
  expect(text).toContain("hello world")
  expect(text).not.toContain("PNG")

  const images = collectImages(prompt, [dir])
  expect(images.length).toBe(1)
  expect(images[0]!.mime).toBe("image/png")
  expect(images[0]!.data).toBe(png.toString("base64"))

  fs.rmSync(dir, { recursive: true, force: true })
})
