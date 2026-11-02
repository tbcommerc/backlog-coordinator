import { tool } from "@opencode-ai/plugin"
import { runCli } from "../lib/run-cli.js"

export default tool({
  description:
    "Записывает оценку фактора F6 «Зависимость от команд» и пересчитывает приоритет задачи. " +
    "Перечисляешь команды, без которых задача не будет завершена, и тип связи с каждой: " +
    "blocking (работа не начнётся), coordination (нужна синхронизация), informational (достаточно уведомить). " +
    "Штраф считает код: блокирующая связь дороже согласования, поэтому тип важнее количества. " +
    "Пустой список — нормальный ответ, если задача самодостаточна.",
  args: {
    task_key: tool.schema.string().describe("ID задачи, например TASK-100-011"),
    teams: tool.schema
      .string()
      .describe('JSON вида [{"team": "AI", "type": "blocking", "reason": "поставляет классификатор"}]; пустой массив [] допустим'),
    rationale: tool.schema.string().describe("Общий вывод одним-двумя предложениями"),
    evidence: tool.schema.string().optional().describe("Идентификаторы фрагментов через запятую"),
    model: tool.schema.string().optional().describe("Имя модели, которой сделана оценка"),
  },
  async execute(args, context) {
    const argv = ["assess-dependencies", args.task_key, "--teams", args.teams,
                  "--rationale", args.rationale ?? "", "--actor", "dependency-analyst"]
    if (args.evidence) argv.push("--evidence", args.evidence)
    if (args.model) argv.push("--model", args.model)
    return runCli(context.directory, argv)
  },
})
