import { tool } from "@opencode-ai/plugin"
import { runCli } from "../lib/run-cli.js"

export default tool({
  description:
    "Список задач Единого бэклога с рассчитанными приоритетами P1–P5, Value и C/V. " +
    "Используй, когда нужно посмотреть, что стоит вверху бэклога, сравнить команды " +
    "или найти задачи с конкретным приоритетом. Сортировка по priority учитывает " +
    "сырой скор внутри одного P.",
  args: {
    sort: tool.schema
      .string()
      .optional()
      .describe("priority | value | cv | key. По умолчанию priority"),
    team: tool.schema
      .string()
      .optional()
      .describe("Ответственная команда, например «Pre-Trade» или «ИТ ЛТ»"),
    priority: tool.schema.string().optional().describe("Фильтр по P1..P5"),
    limit: tool.schema.number().optional().describe("Сколько задач вернуть, по умолчанию 20"),
  },
  async execute(args, context) {
    const argv = ["backlog", "--limit", String(args.limit ?? 20)]
    if (args.sort) argv.push("--sort", args.sort)
    if (args.team) argv.push("--team", args.team)
    if (args.priority) argv.push("--priority", args.priority)
    return runCli(context.directory, argv)
  },
})
