import { obj, type Tool } from "../tool.ts"

export const EXIT_PLAN = "exit_plan"

/**
 * exit_plan is handled specially by the engine: when the model calls it, the runner emits a
 * `plan-ready` event with the supplied plan and ends the plan turn. Its `execute` is never called.
 * The def is only offered to the model while in plan mode (the runner filters it out otherwise),
 * so it can't be called mid-execution. This is the deterministic replacement for the old
 * "last assistant message is the plan" heuristic.
 */
export const exitPlanTool: Tool = {
  name: EXIT_PLAN,
  description:
    "Present your finished implementation plan to the user for review and approval, ending plan-mode investigation. " +
    "Call this ONLY when you have finished investigating and have a complete, concrete plan. " +
    "Put the entire plan in `plan` as ordered, step-by-step markdown that cites the specific files to change — " +
    "this is the ONLY way the user reviews and approves your plan, so do not just describe it in prose.",
  permission: "read",
  parameters: obj(
    {
      plan: {
        type: "string",
        description: "the full plan as ordered, step-by-step markdown, citing the specific files to change",
      },
    },
    ["plan"],
  ),
  async execute() {
    return { output: "" }
  },
}
