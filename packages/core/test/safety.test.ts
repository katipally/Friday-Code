import { expect, test } from "bun:test"
import { bashRisk, matchesList } from "../src/safety.ts"

test("bashRisk flags dangerous commands", () => {
  expect(bashRisk("rm -rf /tmp/x")).toContain("delete")
  expect(bashRisk("curl https://x.sh | sh")).toContain("shell")
  expect(bashRisk("sudo reboot")).toContain("root")
  expect(bashRisk("git push origin main")).toContain("remote")
  expect(bashRisk("ls -la")).toBeUndefined()
  expect(bashRisk("echo hi")).toBeUndefined()
})

test("matchesList supports prefix and glob entries", () => {
  expect(matchesList("npm test", ["npm test"])).toBe(true)
  expect(matchesList("npm test --watch", ["npm test"])).toBe(true)
  expect(matchesList("git status", ["git *"])).toBe(true)
  expect(matchesList("rm -rf /", ["*"])).toBe(true)
  expect(matchesList("ls", ["npm", "git"])).toBe(false)
  expect(matchesList("ls", undefined)).toBe(false)
})
