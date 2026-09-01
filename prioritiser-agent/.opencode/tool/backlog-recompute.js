import { tool } from "@opencode-ai/plugin"
import { runCli } from "../lib/run-cli.js"

export default tool({
  description:
    "Пересчитывает весь бэклог и возвращает сводку: распределение по P1–P5, " +
    "у скольких задач изменился приоритет, распределение уровней уверенности. " +
    "Нужен после изменения справочника весов или единых констант. " +
    "Ответы модели берутся из кэша, поэтому прогон занимает секунды, а не минуты.",
  args: {
    refresh_strategy: tool.schema
      .boolean()
      .optional()
      .describe("Заново опросить Strategy Decomposer по всем задачам (медленно)"),
    no_llm: tool.schema.boolean().optional().describe("Считать без обращения к модели"),
  },
  async execute(args, context) {
    const argv = ["recompute", "--all"]
    if (args.refresh_strategy) argv.push("--refresh-strategy")
    if (args.no_llm) argv.push("--no-llm")
    return runCli(context.directory, argv, 300000)
  },
})
