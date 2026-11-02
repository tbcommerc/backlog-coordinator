import { tool } from "@opencode-ai/plugin"
import { runCli } from "../lib/run-cli.js"

export default tool({
  description:
    "Действующие оценки F5 и F6 по задаче: ответы по критериям, обоснование, источники, " +
    "кто и какой моделью оценивал, версия рубрики. " +
    "Вызывай перед тем, как объяснять эти два фактора или переоценивать задачу — " +
    "возможно, оценка уже есть и переделывать её незачем.",
  args: {
    task_key: tool.schema.string().describe("ID задачи"),
  },
  async execute(args, context) {
    return runCli(context.directory, ["assessments", args.task_key])
  },
})
