import { expect, test } from "bun:test"
import { compareSemver, detectInstallMethod, updateCommand } from "../src/index.ts"

test("compareSemver orders versions and ignores prerelease tags", () => {
  expect(compareSemver("2.1.0", "2.0.1")).toBe(1)
  expect(compareSemver("2.0.1", "2.1.0")).toBe(-1)
  expect(compareSemver("v2.0.0", "2.0.0")).toBe(0)
  expect(compareSemver("2.0.0-beta.1", "2.0.0")).toBe(0) // core compared, tag ignored
  expect(compareSemver("1.9.9", "1.10.0")).toBe(-1) // numeric, not lexical
})

test("updateCommand maps each install method (null for unknown)", () => {
  expect(updateCommand("npm")).toEqual(["npm", "install", "-g", "friday-code@latest"])
  expect(updateCommand("bun")).toEqual(["bun", "add", "-g", "friday-code@latest"])
  expect(updateCommand("brew")?.[0]).toBe("brew")
  expect(updateCommand("scoop")?.[0]).toBe("scoop")
  expect(updateCommand("unknown")).toBeNull()
})

test("detectInstallMethod returns a known method", () => {
  expect(["npm", "bun", "brew", "scoop", "unknown"]).toContain(detectInstallMethod())
})
