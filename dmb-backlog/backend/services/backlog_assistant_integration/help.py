"""Versioned help facts; no model-authored help or external URL fetching."""
TOPICS = [
    ("task", "История задачи", "истори изменен событ", "Откройте карточку задачи и вкладку истории. История показывает сохранённые изменения полей; причины могут быть не указаны."),
    ("backlog", "Поиск задач", "поиск фильтр задач", "В бэклоге задайте фильтры и откройте нужную карточку. Помощник ищет только в доступной области."),
    ("request", "Запросы", "запрос согласован ревью", "Откройте карточку запроса для просмотра состояния и замечаний. Доступ к связанной задаче проверяется отдельно."),
    ("assistant", "Вопросы помощнику", "помощник ответ источник останов", "Укажите объект и период в вопросе. Основания ответа находятся под таблицей. Кнопка «Остановить» отменяет текущий вопрос; закрытие панели сохраняет разговор."),
    ("report", "Подготовка к встрече", "встреч отчет сводк", "Помощник читает сохранённый контекст встречи и доступные задачи. Он не создаёт встречу и не меняет планировщик."),
]


def search_help(topic, surface, customer):
    words = topic.casefold().split()
    ranked = []
    for area, title, keywords, text in TOPICS:
        if customer and area == "report":
            continue
        score = sum(any(word.startswith(stem) or stem.startswith(word) for stem in keywords.split()) for word in words)
        if score:
            ranked.append((score + int(area == surface), {"title": title, "text": text, "version": "2026-10-14"}))
    ranked.sort(key=lambda pair: pair[0], reverse=True)
    return {"items": [value for _, value in ranked[:5]], "total": len(ranked)}
