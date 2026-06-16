import { obj, type Tool } from "../tool.ts"

/**
 * ask_user is handled specially by the engine (it pauses the loop and waits for the user).
 * Its `execute` is never called; the def exists so the model knows the tool is available.
 */
export const askUserTool: Tool = {
  name: "ask_user",
  description:
    "Ask the user one or more clarifying questions and wait for their answers. Provide either a single `question` (with optional `options`), or `questions` to ask several at once — the user can switch between them and confirm all answers together.",
  permission: "read",
  parameters: obj(
    {
      question: { type: "string", description: "the question to ask (for a single question)" },
      options: { type: "array", items: { type: "string" }, description: "(optional) short choices for the single question" },
      questions: {
        type: "array",
        description: "(optional) ask several questions at once instead of `question`",
        items: obj(
          {
            question: { type: "string", description: "the question text" },
            options: { type: "array", items: { type: "string" }, description: "(optional) short choices" },
            multi: { type: "boolean", description: "(optional) allow selecting multiple options" },
          },
          ["question"],
        ),
      },
    },
    [],
  ),
  async execute() {
    return { output: "" }
  },
}

export const ASK_USER = "ask_user"
