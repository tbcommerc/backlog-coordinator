import { tool } from "@opencode-ai/plugin"
import { runCli } from "../lib/run-cli.js"

export default tool({
  description:
    "Запускает ex-post атрибуцию value_external для обслуживающих команд от факта дохода " +
    "фронта за период. Операция перезаписывает value_external у всех закрытых инициатив " +
    "обслуживающих команд и по ТЗ выполняется только по решению методолога или финансиста — " +
    "поэтому в конфигурации она требует подтверждения.",
  args: {
    period: tool.schema.string().describe("Отчётный период, например «3Q 2026»"),
    front_revenue_mln: tool.schema
      .number()
      .describe("Фактический доход фронта (IB + Pre-Trade) за период, млн ₽"),
    include_open: tool.schema
      .boolean()
      .optional()
      .describe("Учитывать незакрытые инициативы (по умолчанию только закрытые)"),
  },
  async execute(args, context) {
    const argv = [
      "attribution",
      "--period",
      args.period,
      "--front-revenue",
      String(args.front_revenue_mln),
    ]
    if (args.include_open) argv.push("--include-open")
    return runCli(context.directory, argv)
  },
})
