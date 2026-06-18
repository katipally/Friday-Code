import { obj, type Tool } from "../tool.ts"

const optionSchema = obj(
  {
    label: { type: "string", description: "the choice, 1-5 words, concise" },
    description: { type: "string", description: "a short explanation of what this choice means or implies" },
    preview: {
      type: "string",
      description:
        "(optional) a multi-line ASCII diagram, mockup, code snippet, or config example shown beside the options so the user can compare choices visually. Use when a picture helps (layouts, structures, before/after); keep lines ≤ 56 chars wide.",
    },
  },
  ["label"],
)

/**
 * ask_user is handled specially by the engine (it pauses the loop and waits for the user).
 * Its `execute` is never called; the def exists so the model knows the tool is available.
 */
export const askUserTool: Tool = {
  name: "ask_user",
  description:
    "Ask the user one or more clarifying questions and wait for their answers. Use this when the request is ambiguous or there is a real decision only the user can make — do NOT guess, and do NOT ask in plain prose.\n" +
    "Provide either a single `question` (with `options`), or `questions` to ask several at once (the user switches between them and confirms together).\n" +
    "ALWAYS supply concrete `options` as { label, description } objects — `label` is the short choice, `description` explains the trade-off. The UI renders them as a selectable menu and ALWAYS adds a free-text 'type your own answer' field automatically, so never add an 'Other' / catch-all option and never list choices inside the question text.\n" +
    "If you recommend an option, put it FIRST and append ' (recommended)' to its label. Set `multi: true` to let the user pick several. Give each question a short `header` (≤30 chars) so multi-question prompts are easy to scan.",
  permission: "read",
  parameters: obj(
    {
      question: { type: "string", description: "the question to ask (for a single question) — just the question, no inline choices" },
      header: { type: "string", description: "a very short label for the question, e.g. \"Auth method\" (≤30 chars)" },
      options: { type: "array", items: optionSchema, description: "the choices, as { label, description } objects — put choices HERE, not in the question text" },
      multi: { type: "boolean", description: "(optional) allow selecting multiple options for the single question" },
      questions: {
        type: "array",
        description: "(optional) ask several questions at once instead of `question`",
        items: obj(
          {
            question: { type: "string", description: "the question text — just the question, no inline choices" },
            header: { type: "string", description: "a very short label for this question (≤30 chars)" },
            options: { type: "array", items: optionSchema, description: "the choices, as { label, description } objects" },
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
