import { tool } from "@opencode-ai/plugin"
import { runCli } from "../lib/run-cli.js"

export default tool({
  description:
    "Версия и состав зашитого слепка исторических Value: сколько задач с человеческой " +
    "оценкой в нём лежит, когда он собран и какой максимум используется для шкалы " +
    "фактора Value. Вызывай, когда пользователь спрашивает, откуда агент знает про " +
    "аналоги, или сомневается в свежести оценок: слепок обновляется отдельно от " +
    "агента, и между обновлениями он стареет.",
  args: {},
  async execute(_args, context) {
    return runCli(context.directory, ["snapshot"])
  },
})
