import { tool } from "@opencode-ai/plugin"
import { runCli } from "../lib/run-cli.js"

export default tool({
  description:
    "Рубрика оценки факторов: критерии стратегического соответствия с вариантами ответов и " +
    "весами (F5) и типы зависимостей между командами со штрафами (F6). " +
    "Вызывай ПЕРВЫМ делом перед оценкой: отвечать нужно теми ключами вариантов, которые " +
    "перечислены в рубрике, а веса могли измениться с прошлого раза.",
  args: {
    factor: tool.schema.string().optional().describe("F5 или F6; без аргумента — обе рубрики"),
  },
  async execute(args, context) {
    const argv = ["rubric"]
    if (args.factor) argv.push("--factor", args.factor)
    return runCli(context.directory, argv)
  },
})
