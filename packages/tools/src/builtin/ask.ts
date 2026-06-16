import { obj, type Tool } from "../tool.ts"

/**
 * ask_user is handled specially by the engine (it pauses the loop and waits for the user).
 * Its `execute` is never called; the def exists so the model knows the tool is available.
 */
export const askUserTool: Tool = {
  name: "ask_user",
  description:
    "Ask the user one or more clarifying questions and wait for their answers. Provide either a single `question` (with optional `options`), or `questions` to ask several at once — the user can switch between them and confirm all answers together. " +
    "IMPORTANT: when offering choices, ALWAYS put them in the `options` array — never list them inside the question text. The UI renders `options` as a selectable menu (numbered, keyboard-navigable) and always adds a free-text 'custom answer' field, so you never need to spell out the choices in prose.",
  permission: "read",
  parameters: obj(
    {
      question: { type: "string", description: "the question to ask (for a single question) — just the question, no inline choices" },
      options: { type: "array", items: { type: "string" }, description: "short choices for the single question — put choices HERE, not in the question text" },
      questions: {
        type: "array",
        description: "(optional) ask several questions at once instead of `question`",
        items: obj(
          {
            question: { type: "string", description: "the question text — just the question, no inline choices" },
            options: { type: "array", items: { type: "string" }, description: "short choices — put choices HERE, not in the question text" },
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
