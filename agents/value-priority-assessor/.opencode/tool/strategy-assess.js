import { tool } from "@opencode-ai/plugin"
import { runCli } from "../lib/run-cli.js"

export default tool({
  description:
    "Записывает оценку фактора F5 «Стратегическое соответствие» по рубрике и пересчитывает " +
    "приоритет задачи. Ты отвечаешь на критерии — итоговый балл считает код по весам рубрики, " +
    "выставлять число самому не нужно и нельзя. " +
    "Оценка сохраняется с обоснованием и ссылками на источники, поэтому её можно оспорить " +
    "по конкретному критерию. Недопустимый вариант ответа вернёт ошибку с перечнем допустимых.",
  args: {
    task_key: tool.schema.string().describe("ID задачи, например TASK-100-011"),
    answers: tool.schema
      .string()
      .describe('JSON вида {"strategic_theme": "direct", "revenue_link": "enabling", ...} — по одному ответу на каждый критерий рубрики'),
    rationale: tool.schema
      .string()
      .describe("Одно-два предложения: на чём основана оценка. Без обоснования оценка бесполезна методологу"),
    evidence: tool.schema
      .string()
      .optional()
      .describe("Идентификаторы фрагментов из rag-search через запятую — они повышают уровень уверенности оценки"),
    model: tool.schema.string().optional().describe("Имя модели, которой сделана оценка"),
  },
  async execute(args, context) {
    const argv = ["assess-strategy", args.task_key, "--answers", args.answers,
                  "--rationale", args.rationale ?? "", "--actor", "strategy-analyst"]
    if (args.evidence) argv.push("--evidence", args.evidence)
    if (args.model) argv.push("--model", args.model)
    return runCli(context.directory, argv)
  },
})
