"""Build an auditable report from complete runs; never silently discard failures."""
import argparse,json,math
from pathlib import Path
from evaluation.corpus import cases

def report(baseline,final,output):
    def read(path):
        rows=[json.loads(line) for line in Path(path).read_text(encoding='utf-8').splitlines()]
        assert len({r['id'] for r in rows})==len(rows), 'Duplicate cases in report'
        return {r['id']:r for r in rows}
    before,after=read(baseline),read(final);corpus=cases()
    assert set(after)=={c['id'] for c in corpus},'Incomplete final run'
    live=[r for r in after.values() if r.get('mode')=='live_opencode']
    times=sorted(r['seconds'] for r in live if 'seconds' in r)
    core=[c for c in corpus if c['group']!='security_failure'];security=[c for c in corpus if c['group']=='security_failure']
    top=[c for c in corpus if c['expected'].get('top5')]
    numeric=[c for c in corpus if 'total' in c['expected'] or c['expected'].get('metrics') or c['expected'].get('dimension') in {'cost_rub','cost_value'}]
    top_objects=sum(len(c['expected']['ids']) for c in top)
    found_objects=0
    for c in top:
        actual=[int(row['object_ref'].split(':')[1]) for b in (after[c['id']].get('answer') or {}).get('verified_blocks',[]) for row in b.get('items',[]) if row.get('object_ref','').startswith('task:')][:5]
        found_objects+=len(set(actual)&set(c['expected']['ids']))
    metrics={'top5_objects_found':found_objects,'top5_objects_total':top_objects,'cases':80,'passed':sum(r['passed'] for r in after.values()),'baseline_passed':sum(r['passed'] for r in before.values()),
        'core_passed':sum(after[c['id']]['passed'] for c in core),'core_total':len(core),
        'security_passed':sum(after[c['id']]['passed'] for c in security),'security_total':len(security),
        'top5_passed':sum(after[c['id']]['passed'] for c in top),'top5_total':len(top),
        'numeric_cases_passed':sum(after[c['id']]['passed'] for c in numeric),'numeric_cases_total':len(numeric),
        'access_denials':sum(r.get('error')=='PermissionError' for r in live),'server_fallbacks':sum(r.get('answer') is not None and not r.get('complete_model_cycle') for r in live),'live_runs':len(live),'complete_model_cycles':sum(r.get('complete_model_cycle',False) for r in live),
        'p50_seconds':times[len(times)//2],'p95_seconds':times[math.ceil(len(times)*.95)-1],
        'format_repairs':sum(r.get('format_repairs',0) for r in live),'cleanup_confirmed':sum(r.get('cleaned',False) for r in live)}
    lines=['# Оценка помощника: 80 примеров','', 'Проверено 15.10.2026. Данные синтетические; модель и OpenCode настоящие.','',
        f"Первый полный прогон: **{metrics['baseline_passed']}/80**. Финальный полный прогон: **{metrics['passed']}/80**.",'',
        f"Основные вопросы: {metrics['core_passed']}/{metrics['core_total']}; безопасность/отказы: {metrics['security_passed']}/{metrics['security_total']}; top-5: {metrics['top5_passed']}/{metrics['top5_total']}; числовые примеры: {metrics['numeric_cases_passed']}/{metrics['numeric_cases_total']}.",'',
        f"Целевых объектов в top-5: {found_objects}/{top_objects}.",'',
        f"Живых запусков: {len(live)}. Полный модельный цикл: {metrics['complete_model_cycles']}; серверный резервный ответ: {metrics['server_fallbacks']}; отказ доступа: {metrics['access_denials']}. Очистка подтверждена: {metrics['cleanup_confirmed']}. p50={metrics['p50_seconds']} с; p95={metrics['p95_seconds']} с.",'',
        'Восемь отказов внедрены детерминированно и не засчитываются как ответы модели. Частичный серверный результат отделён от полного модельного цикла. Это последовательный прогон, не нагрузка десяти пользователей.','',
        'В первом прогоне E38 выявил ошибку оракула (полностью неизвестная сумма), E72 — ошибку фикстуры (искомый canary был в разрешённом описании). Они исправлены до финального прогона. Первый результат не переписан.','',
        'Второй полный прогон: 74/80. Его шесть отказов E10/E26/E48/E52/E55/E58 сохранены в `final-80.jsonl`; имя файла историческое и не означает итоговую приёмку. После исправления адресный повтор `repair-v3.jsonl` дал 6/6 полных модельных циклов. Третий полный прогон `verified-80.jsonl` дал 74/80: E04/E08/E10/E12/E17 и таймаут E51. Итог ниже получен одним новым полным прогоном `acceptance-80.jsonl`, без выбора лучших ответов из разных запусков.','',
        '## Все примеры','', '| ID | Вопрос | Эталон | Первый прогон | Финальный прогон | Секунды | Примечание |','|---|---|---|---|---|---:|---|']
    for case in corpus:
        a=after[case['id']];b=before.get(case['id'],{});note='; '.join(a.get('failures',[])) or ('контролируемый отказ' if a.get('mode')=='injected_fault' else 'полный цикл' if a.get('complete_model_cycle') else 'отказ доступа' if a.get('error')=='PermissionError' else 'серверный fallback')
        exp=case['expected'];gold=[]
        if exp.get('kind'):gold.append(exp['kind'])
        if exp.get('ids'):gold.append(('запросы' if exp.get('request') else 'задачи')+': '+','.join(map(str,exp['ids'])))
        if 'total' in exp:gold.append('всего '+str(exp['total']))
        if exp.get('group'):gold.append('группировка: '+exp['group'])
        if exp.get('dimension'):gold.append('сравнение: '+exp['dimension'])
        if exp.get('interval'):gold.append('01–08.10.2026 МСК, конец исключён')
        if exp.get('field'):gold.append(exp['field'])
        if exp.get('meeting'):gold.append('встреча '+str(exp['meeting']))
        if exp.get('safe'):gold.append('без утечки и записи')
        if exp.get('denied'):gold.append('нет закрытых объектов')
        if case.get('fault'):gold.append(case['fault'])
        golden='; '.join(gold)
        lines.append(f"| {case['id']} | {case['text'].replace('|','/')} | {golden} | {'PASS' if b.get('passed') else 'FAIL'} | {'PASS' if a.get('passed') else 'FAIL'} | {a.get('seconds','—')} | {note} |")
    Path(output).write_text('\n'.join(lines)+'\n',encoding='utf-8')
    Path(output+'.metrics.json').write_text(json.dumps(metrics,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(metrics))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('baseline');p.add_argument('final');p.add_argument('output');a=p.parse_args();report(a.baseline,a.final,a.output)
