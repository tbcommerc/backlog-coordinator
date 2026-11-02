import { tool } from "@opencode-ai/plugin"
import { runCli } from "../lib/run-cli.js"

export default tool({
  description:
    "Полная карточка одной задачи: приоритет, вклад каждого из восьми факторов, " +
    "вводные расчёта Value, текст подсказки, сработавшие правила-овверрайды и " +
    "история изменений приоритета. Вызывай перед тем, как объяснять пользователю, " +
    "почему у задачи именно такой приоритет — сочинять объяснение по названию задачи нельзя.",
  args: {
    task_key: tool.schema.string().describe("ID задачи, например TASK-100-011"),
  },
  async execute(args, context) {
    return runCli(context.directory, ["show", args.task_key])
  },
})
