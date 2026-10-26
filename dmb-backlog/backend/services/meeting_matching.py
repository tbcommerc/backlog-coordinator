"""Explainable lexical shortlist, never a probability or automatic assignment."""
import re

STOP = set("который которая задачи задача встречи встреча нужно сделать будет чтобы также этого этого после перед через поручение договорились".split())


def terms(text):
    return {word[:6] for word in re.findall(r"[а-яёa-z0-9]+", text.lower().replace("ё", "е"))
            if len(word) > 3 and word not in STOP}


def rank_tasks(text, tasks, limit=3):
    query = terms(text)
    ranked = []
    for task in tasks:
        title_terms = terms(task.title)
        overlap = query & (title_terms | terms(task.description or ""))
        if not overlap:
            continue
        score = len(overlap) + 2 * len(query & title_terms)
        ranked.append((score, task.id, {
            "id": task.id, "public_id": task.public_id, "title": task.title,
            "reason": "Совпадение по теме: " + ", ".join(sorted(overlap)[:5]),
        }))
    ranked.sort(key=lambda row: (-row[0], row[1]))
    return [row[2] for row in ranked[:limit]]
