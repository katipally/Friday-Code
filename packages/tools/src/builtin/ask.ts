import { obj, type Tool } from "../tool.ts"

/**
 * ask_user is handled specially by the engine (it pauses the loop and waits for the user).
 * Its `execute` is never called; the def exists so the model knows the tool is available.
 */
export const askUserTool: Tool = {
  name: "ask_user",
  description:
    "Ask the user a clarifying question and wait for their answer. Optionally provide a few short options.",
  permission: "read",
  parameters: obj(
    {
      question: { type: "string", description: "the question to ask" },
      options: { type: "array", items: { type: "string" }, description: "(optional) short choices" },
    },
    ["question"],
  ),
  async execute() {
    return { output: "" }
  },
}

export const ASK_USER = "ask_user"
