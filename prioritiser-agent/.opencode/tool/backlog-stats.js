import { tool } from "@opencode-ai/plugin"
import { runCli } from "../lib/run-cli.js"

export default tool({
  description:
    "Сводка по бэклогу: сколько задач в каждом приоритете, разбивка по командам " +
    "и по уровням уверенности в оценке Value. Быстрый способ понять, как методика " +
    "разложила бэклог, прежде чем разбирать отдельные задачи.",
  args: {},
  async execute(_args, context) {
    return runCli(context.directory, ["stats"])
  },
})
