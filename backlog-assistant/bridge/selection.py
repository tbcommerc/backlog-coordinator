"""Narrow obvious single-intent tool sets; unknown or compound intents keep the catalog."""
import re

def select_catalog(catalog, text):
    value=text.casefold()
    intents=[]
    if re.search(r'сравн|сопостав',value):intents.append('compare_tasks')
    if re.search(r'сгрупп|сумм|сколько|количеств|число задач|распределен',value):intents.append('aggregate_backlog')
    if re.search(r'изменени|изменилось',value):intents.append('query_changes')
    if re.search(r'встреч',value):intents.append('read_meeting_context')
    if re.search(r'\brequest:\d+',value):intents.append('read_request')
    if re.search(r'\btask:\d+',value) and not intents:intents.append('read_task')
    if not intents and re.search(r'найди|найти|покажи.*задач|список.*задач',value):intents.append('search_work_items')
    if len(intents)!=1:return catalog
    allowed=({'resolve_context','aggregate_backlog'} if intents[0]=='aggregate_backlog'
             else {'resolve_context','search_work_items','search_help',intents[0]})
    return dict(catalog, tools=[tool for tool in catalog['tools'] if tool['name'] in allowed])


def explicit_query(text):
    """Only complete, positive canonical commands; never infer from negated prose."""
    value=text.strip().rstrip('.!?').casefold()
    query={}
    if re.fullmatch(r'(?:покажи|найди) мои задачи',value):query['relationship']='mine'
    if re.fullmatch(r'(?:покажи|найди) задачи моей команды',value):query['relationship']='my_team'
    missing=re.fullmatch(r'(?:покажи|найди) задачи без (.+)',value)
    names={'ответственного':'owner','оценки стоимости':'effort','стоимости':'effort','финансового эффекта':'effect','планового периода':'period'}
    if missing and missing[1] in names:query['missing']=[names[missing[1]]]
    topic=re.fullmatch(r'(?:покажи|найди) задач[уиы] (?:о|об|про) (.+)',value)
    if topic:query['terms']=[topic[1]]
    return query
