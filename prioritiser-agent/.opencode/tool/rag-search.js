import { tool } from "@opencode-ai/plugin"
import { runCli } from "../lib/run-cli.js"

export default tool({
  description:
    "Поиск по корпусу знаний. Четыре слоя: k3 — закрытый пакет банка (продуктовый альбом ДИД, " +
    "акционерные и мезонинные продукты, критерии применимости, риски); knowledge — обезличенные " +
    "описания команд и продуктов трайба; backlog — 440 исторических задач для аналогий; " +
    "methodology — правила расчёта Value и приоритета. " +
    "Поиск гибридный: BM25 плюс векторный слой, объединение через RRF. " +
    "Каждый результат возвращается с источником — ссылайся на него, когда обосновываешь оценку. " +
    "Почти всегда указывай layer: без него короткие задачи бэклога вытесняют из выдачи " +
    "длинные секции продуктовых документов.",
  args: {
    query: tool.schema.string().describe("Поисковый запрос на русском"),
    layer: tool.schema
      .string()
      .optional()
      .describe(
        "k3 — продукты и риски ДИД из закрытого пакета; knowledge — про команды трайба; " +
          "backlog — аналогии по прошлым задачам; methodology — правила расчёта",
      ),
    top_k: tool.schema.number().optional().describe("Сколько фрагментов вернуть, по умолчанию 5"),
  },
  async execute(args, context) {
    const argv = ["rag", args.query, "--top-k", String(args.top_k ?? 5)]
    if (args.layer) argv.push("--layer", args.layer)
    return runCli(context.directory, argv)
  },
})
