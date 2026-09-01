import { tool } from "@opencode-ai/plugin"
import { runCli } from "../lib/run-cli.js"

export default tool({
  description:
    "Состояние базы знаний: сколько фрагментов в каждом слое, включён ли векторный поиск, " +
    "какая модель эмбеддингов и какая версия закрытого пакета K3 установлена. " +
    "Вызывай, если поиск возвращает пустоту или если нужно понять, доступен ли слой k3 " +
    "в текущей конфигурации — пакет может быть не установлен.",
  args: {},
  async execute(_args, context) {
    return runCli(context.directory, ["rag-status"])
  },
})
