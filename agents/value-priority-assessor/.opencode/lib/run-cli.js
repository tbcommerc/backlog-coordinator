// Общий мост между инструментами opencode и Python-ядром.
//
// Все расчёты живут в `app/`, а инструменты агента — тонкие обёртки над
// `python -m app.cli`. Тот же приём использует strategy-decomposer, и по той же
// причине: модель не должна считать Value или приоритет сама. Она собирает
// вводные и объясняет результат, арифметику выполняет детерминированный код,
// иначе два прогона одного бэклога дали бы разные приоритеты.

import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"

// Виртуальное окружение проекта приоритетнее системного python: в нём
// гарантированно стоят зависимости из requirements.txt.
export function resolvePython(directory) {
  if (process.env.PRIORITISER_PYTHON) return process.env.PRIORITISER_PYTHON
  const venv = join(directory, ".venv", "bin", "python")
  return existsSync(venv) ? venv : "python3"
}

export function runCli(directory, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const python = resolvePython(directory)
    const child = spawn(python, ["-m", "value_priority_assessor.cli", ...args], {
      cwd: directory,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    })

    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error(`prioritiser CLI timeout after ${timeoutMs}ms: ${args.join(" ")}`))
    }, timeoutMs)

    child.stdout.on("data", (chunk) => (stdout += chunk))
    child.stderr.on("data", (chunk) => (stderr += chunk))
    child.on("error", (error) => {
      clearTimeout(timer)
      reject(new Error(`не удалось запустить ${python}: ${error.message}`))
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`prioritiser CLI exit ${code}: ${stderr.trim() || stdout.trim()}`))
        return
      }
      // Контракт CLI — ровно один JSON-объект на stdout. Возвращаем строку как
      // есть: агент получает те же данные, что и человек в терминале.
      resolve(stdout.trim())
    })
  })
}
