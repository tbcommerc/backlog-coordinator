import { readFileSync, writeFileSync } from 'node:fs';
const data=JSON.parse(readFileSync(new URL('./migration-matrix.json',import.meta.url),'utf8'));
const link=(path,label)=>`[${label}](../${path})`;
const safe=value=>String(value).replaceAll('|',' / ').replaceAll('\n',' ');
const status = data.status === 'verified' ? 'миграция активного SPA принята в указанном объёме' : 'итоговая приёмка выполняется';
let text=`# Матрица миграции UI kit\n\nПроверено: **${data.reviewed}**. Статус: **${status}**.\n\nИсточник инвентаря: [migration-matrix.json](../frontend/ui-catalog/migration-matrix.json). Документ генерируется командой \`node frontend/ui-catalog/render-migration-matrix.mjs\` из каталога \`dmb-backlog\`.\n\n${data.statesContract}\n\nКаждая строка содержит прямые браузерные проверки и их область. Предметная компоновка допустима при соблюдении контрактов общих контролов. Проверки исходников: [uiSizingOwnership](../frontend/tests/uiSizingOwnership.test.mjs) и [uiMigrationMatrix](../frontend/tests/uiMigrationMatrix.test.mjs).\n\n`;
for (const [family,label] of [[1,'Бэклоги, канбан, реестры и оболочка'],[2,'Карточки, запросы, ревью и формы'],[3,'Оценка, встречи и отчёты'],[4,'Аналитика, уведомления и AI']]) {
 text+=`## ${label}\n\n| Поверхность и вход | Общие компоненты | Применимые состояния | Предметная часть | Проверки и область подтверждения |\n|---|---|---|---|---|\n`;
 for (const row of data.surfaces.filter(row=>row.family===family)) text+=`| ${link(row.source,safe(row.title))} · \`${safe(row.entry)}\` | ${row.components.join(', ')} | ${row.states.join(', ')} | ${safe(row.local)} | ${row.tests.length?row.tests.map(name=>link('frontend/e2e/'+name,name)).join(', '):'**Нет браузерного подтверждения UI kit**'} ${row.tests.length?safe(row.verifiedScope):''} |\n`;
 text+='\n';
}
text+='## Адресные исключения\n\n';
for(const item of data.exceptions)text+=`- ${link(item.source,item.source)} — ${item.reason}\n`;
text+='\n## Неактивные и standalone-поверхности\n\n';
for(const item of data.excluded)text+=`- \`${item.source}\` — ${item.decision}\n`;
text+='\n## Контроль охвата\n\nВсе статические маршруты router.js и модули components/ контролируются uiMigrationMatrix.test.mjs. Динамические маршруты, вкладки, панели и диалоги перечислены явно. Список модулей сам по себе не доказывает полноту состояний: при добавлении поверхности запись и применимые сценарии обновляются вместе с кодом.\n';
if (data.consistencyReview) {
 const review=data.consistencyReview;
 text+=`\n## Согласованность компонентов — ${review.date}\n\n${review.scope}\n\n${review.contract}\n\n${review.variants}\n\nПроверки: ${review.tests.map(name=>link('frontend/e2e/'+name,name)).join(', ')}; защита исходников: ${link('frontend/tests/uiStyleOwnership.test.mjs','uiStyleOwnership')}.\n\n${review.limitations}\n`;
}
const target=new URL('../../docs/UI_KIT_MIGRATION_MATRIX.md',import.meta.url);
if(process.argv.includes('--check')) { if(readFileSync(target,'utf8')!==text)throw new Error('Migration matrix Markdown is stale'); }
else writeFileSync(target,text);
