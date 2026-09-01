import { tool } from "@opencode-ai/plugin"
import { runCli } from "../lib/run-cli.js"

export default tool({
  description:
    "Читает действующую версию справочника агента: value_drivers (величины расчёта эффекта), " +
    "factor_weights (веса восьми факторов и пороги P1–P5), overrides (правила-овверрайды), " +
    "teams (зарабатывающие и обслуживающие команды), customer_levels, task_types, value_defaults. " +
    "Обращайся сюда, когда нужно назвать точное значение ставки, веса или порога — " +
    "не воспроизводи их по памяти.",
  args: {
    name: tool.schema
      .string()
      .describe("value_drivers | factor_weights | overrides | teams | customer_levels | task_types | value_defaults"),
  },
  async execute(args, context) {
    return runCli(context.directory, ["reference", args.name])
  },
})
