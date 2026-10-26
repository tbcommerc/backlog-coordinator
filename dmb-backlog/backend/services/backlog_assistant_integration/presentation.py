"""Pure server presentation of already authorized receipts."""

from fastapi import HTTPException

def denied():
    raise HTTPException(404, "not_found_or_forbidden")

def present(candidate, by_ref):
    blocks = []
    for block in candidate.get("data_blocks", []):
        if block["server_result_ref"] not in by_ref:
            denied()
        blocks.append(dict(by_ref[block["server_result_ref"]]["data"], result_ref=block["server_result_ref"], tool_name=by_ref[block["server_result_ref"]].get("tool_name")))
    # Model claims are advisory. Until the semantic/numeric evaluator is qualified,
    # publish only deterministic server facts; never label unverified prose a fact.
    results = list(by_ref.values())
    final_results = [r for r in results if r.get("tool_name") != "resolve_context"]
    if final_results:
        # Resolutions are planning evidence, not counts of work items.
        results = final_results
        final_refs = {r["snapshot_ref"] for r in results}
        blocks = [b for b in blocks if b["result_ref"] in final_refs]
    elif results:
        choices = next((r for r in results if r["data"].get("total") != 1), results[-1])["data"].get("items", [])
        candidate = dict(candidate, kind="clarification", clarification=candidate.get("clarification") or {
            "question": "Уточните название команды, статуса или планового периода: подсчёт задач ещё не выполнен.",
            "options": [str(row.get("title", "Объект")) for row in choices[:5]]})
        blocks = []
    if final_results and not blocks:
        blocks = [dict(r["data"], result_ref=r["snapshot_ref"], tool_name=r.get("tool_name")) for r in results]
    if results and all(r.get("tool_name") == "resolve_context" for r in results):
        choices = next((r for r in results if r["data"].get("total") != 1), results[-1])["data"].get("items", [])
        if len(choices) > 1:
            candidate = dict(candidate, kind="clarification", clarification={
                "question": "Найдено несколько совпадений. Уточните, какое вы имеете в виду.",
                "options": [str(row.get("title", "Объект")) + " (" + str(row.get("object_ref", "")) + ")" for row in choices[:5]]})
    claims = []
    for r in results:
        if r.get("tool_name") == "resolve_context":
            continue
        data = r["data"]
        if "total" not in data:
            continue
        name = r.get("tool_name")
        if name == "aggregate_backlog":
            text = f"Задач в выборке: {data['total']}. Групп: {data.get('group_total', len(data.get('items', [])))}."
        elif name == "read_request":
            comments = [item.get("review_comment") for item in data.get("items", []) if item.get("review_comment")]
            text = "Комментарий к решению: " + "; ".join(comments) if comments else "Причина текущего статуса в комментарии к решению не зафиксирована."
        elif name == "query_changes":
            text = f"Изменений за интервал: {data['total']}. Затронуто задач: {data.get('unique_tasks', 0)}. Причина изменения не зафиксирована в событиях."
        else:
            text = f"В выборке найдено: {data['total']}. Показано: {r['coverage']['displayed_count']}."
        claims.append({"text": text, "type": "fact", "source_ids": [r["sources"][0]["source_id"]]})
    safe = dict(candidate, summary_claims=claims, actions=[], followups=[], verified_blocks=blocks,
        sources=[source for result in by_ref.values() for source in result["sources"]],
        limitations=list(dict.fromkeys([l for r in results for l in r["limitations"]] +
            (["Показаны проверенные данные источников; свободное пояснение не подтверждено."] if candidate.get("kind") == "partial" else []))))
    if candidate.get("kind") == "clarification":
        safe["kind"] = "clarification"
    elif not results:
        safe["kind"] = "unavailable"
    if results:
        safe["as_of"] = max(r["observed_at"] for r in results)
        if candidate.get("kind") != "clarification":
            safe["kind"] = "no_results" if all(r["coverage"]["matched_total"] == 0 for r in results) else "partial" if safe["limitations"] else "answer"
    safe["coverage"] = results[-1]["coverage"] if results else {
        "matched_total": 0, "displayed_count": 0, "history_complete": False, "omitted_count": 0, "unknown_count": 0, "reasons": []}
    return safe


def coverage_for(data, limitations):
    total, shown = data.get("total", 0), len(data.get("items", []))
    complete = (not bool(data.get("next_cursor"))
        and data.get("history_total", 0) <= len(data.get("history", []))
        and data.get("comments_total", 0) <= len(data.get("comments", [])))
    return {"matched_total": total, "displayed_count": shown, "history_complete": complete,
        "omitted_count": max(0, data.get("group_total", total)-shown), "unknown_count": 0, "reasons": limitations}
