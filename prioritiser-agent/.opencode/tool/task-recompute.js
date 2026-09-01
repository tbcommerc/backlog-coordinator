import { tool } from "@opencode-ai/plugin"
import { runCli } from "../lib/run-cli.js"

export default tool({
  description:
    "Пересчитывает Value, C/V и приоритет одной задачи по действующим справочникам. " +
    "Задача оценивается в шкале всего бэклога, поэтому результат сопоставим с соседями. " +
    "Вызывай после правки атрибутов задачи.",
  args: {
    task_key: tool.schema.string().describe("ID задачи, например TASK-100-011"),
    refresh_strategy: tool.schema
      .boolean()
      .optional()
      .describe("Заново опросить Strategy Decomposer по фактору F5"),
    no_llm: tool.schema
      .boolean()
      .optional()
      .describe("Считать без обращения к модели, только по атрибутам задачи"),
  },
  async execute(args, context) {
    const argv = ["recompute", args.task_key]
    if (args.refresh_strategy) argv.push("--refresh-strategy")
    if (args.no_llm) argv.push("--no-llm")
    return runCli(context.directory, argv)
  },
})
