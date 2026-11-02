import { tool } from "@opencode-ai/plugin"
import { runCli } from "../lib/run-cli.js"

export default tool({
  description:
    "Сценарий Координатора бэклога: рассчитать Value(internal) или приоритет по " +
    "атрибутам задачи, которой нет в базе. Это тот же путь, которым агента будет " +
    "вызывать ПРОМ-вариант единого бэклога. Вызывай его всегда, когда просят оценить " +
    "инициативу по описанию, а не по ID задачи — сочинять цифру самому нельзя. " +
    "Возвращает ровно три поля шаблона Координатора и ничего сверх них: сценарий value — " +
    "value_internal, value_internal_confidence, value_internal_logic; сценарий priority — " +
    "priority_score, priority_score_confidence, priority_score_logic. Это тот самый payload, " +
    "который уйдёт в Координатор, поэтому ВЫВОДИ ЕГО ДОСЛОВНО в блоке кода, а свои пояснения " +
    "давай отдельно после него. Приоритет в сценарии value не считается. " +
    "Для сценария priority обязательны " +
    "трудозатраты и ФИО заказчика: без них вернётся отказ со списком недостающих полей, " +
    "и это правильный ответ, а не сбой — их надо спросить у пользователя.",
  args: {
    scenario: tool.schema
      .string()
      .describe(
        "value — рассчитать ТОЛЬКО финансовый эффект; priority — определить приоритет. " +
        "Выбирай строго по тому, о чём попросили: на «рассчитай value» приоритет считать " +
        "запрещено, на него Координатор присылает отдельный запрос."
      ),
    task_id: tool.schema.string().describe("ID задачи; для новой инициативы можно условный"),
    task_type: tool.schema
      .string()
      .describe("Тип: МЕТРИЧЕСКИЕ KR, КВАРТАЛЬНАЯ/ГОДОВАЯ ЦЕЛЬ, AD-HOC, ИССЛЕДОВАНИЕ"),
    team: tool.schema.string().describe("Ответственная команда или кластер"),
    title: tool.schema.string().describe("Наименование задачи / краткая постановка"),
    project: tool.schema.string().optional().describe("Проект; весомее названия для стратегии"),
    deadline: tool.schema.string().optional().describe("Срок как в бэклоге: «3Q 2026», «2026»"),
    description: tool.schema.string().optional(),
    customer_division: tool.schema.string().optional().describe("Подразделение заказчика"),
    involved_teams: tool.schema.string().optional().describe("Другие вовлечённые команды"),
    effort_man_days: tool.schema.number().optional().describe("Трудозатраты, ч/д (для priority)"),
    business_customer: tool.schema.string().optional().describe("ФИО заказчика (для priority)"),
    value_internal_mln: tool.schema
      .number()
      .optional()
      .describe("Value, если его заполнил человек — тогда агент его не пересчитывает"),
  },
  async execute(args, context) {
    const cli = ["agent", args.scenario, "--task-id", args.task_id,
      "--task-type", args.task_type, "--team", args.team, "--title", args.title]

    const optional = {
      "--project": args.project,
      "--deadline": args.deadline,
      "--description": args.description,
      "--customer-division": args.customer_division,
      "--involved-teams": args.involved_teams,
      "--effort": args.effort_man_days,
      "--customer": args.business_customer,
      "--value": args.value_internal_mln,
    }
    for (const [flag, value] of Object.entries(optional)) {
      if (value !== undefined && value !== null && value !== "") cli.push(flag, String(value))
    }

    return runCli(context.directory, cli, 300000)
  },
})
