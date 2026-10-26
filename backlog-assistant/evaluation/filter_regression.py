"""Live model regression on synthetic fixtures only; never connects to DMB."""
import asyncio
import copy
import json
from pathlib import Path
from types import SimpleNamespace
from evaluation import data, run

async def main():
    data.TASKS=copy.deepcopy(data.TASKS)
    for row in data.TASKS:
        if row['team_id']==1: row['team']='Проектный офис'
        if row['status']=='В работе': row['status']='ПРИНЯТА В РАБОТУ'
        if row['period']=='1Q 2026': row['period']='4Q 2026'
    env={}
    for line in Path('../agent/.env').read_text(encoding='utf-8-sig').splitlines():
        key,sep,value=line.partition('=')
        if sep and key.strip() in {'OPENAI_BASE_URL','OPENAI_API_KEY','OPENAI_MODEL'}:
            env[key.strip()]=value.strip().strip(chr(34)).strip(chr(39))
    provider=(env['OPENAI_BASE_URL'],env['OPENAI_API_KEY'],env['OPENAI_MODEL'])
    env.clear()
    args=SimpleNamespace(native=True,state='../.runtime/filter-regression',image=None)
    questions=[
        ('Сколько задач 4-го квартала в работе у проектного офиса?',1),
        ('Сколько задач в статусе «В работе» у команды «Проектный офис» на Q4 2026?',1),
        ('Сколько задач у проектного офиса?',4),
        ('Сколько задач в работе?',4),
        ('Сколько задач запланировано на 4 квартал 2026?',3),
        ('Сколько задач в работе на 4 квартал 2025 у проектного офиса?',None),
    ]
    results=[]
    for i,(text,total) in enumerate(questions):
        case={'id':f'F{i+1}','group':'compound_filters','text':text,'expected':{}}
        report=await run.live(case,args,provider)
        calls=report.get('calls',[])
        answer=report.get('answer') or {}
        blocks=answer.get('verified_blocks',[])
        aggregates=[b for b in blocks if b.get('tool_name')=='aggregate_backlog']
        passed=(answer.get('kind')=='clarification' if total is None else bool(aggregates and aggregates[-1]['total']==total and report.get('complete_model_cycle')))
        results.append(dict(report,id=case['id'],text=text,expected_total=total,passed=passed))
        print(case['id'], 'PASS' if passed else 'FAIL',answer.get('kind'), [b.get('total') for b in aggregates],report.get('error'), report.get('runtime_start_exit'), report.get('runtime_start_diagnostic'),flush=True)
    Path('../.runtime/filter-regression-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
    if not all(r['passed'] for r in results): raise SystemExit(1)

if __name__=='__main__': asyncio.run(main())
