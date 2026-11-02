import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const modal = readFileSync(new URL('../js/components/modal.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../css/components.css', import.meta.url), 'utf8');

test('карточка помечает доступные для inline-редактирования поля', () => {
  for (const key of ['title', 'description', 'comment', 'status', 'priority', 'deadline', 'progress', 'effortDays', 'weightPercent', 'forecastPercent', 'assignee', 'team', 'otherTeams', 'customer', 'project', 'type', 'tags']) {
    assert.match(modal, new RegExp(`editKey: e \\? '' : '${key}'|data-inline-edit="${key}"`));
  }
});

test('другие вовлечённые команды доступны для быстрого редактирования', () => {
  assert.match(modal, /edit\('otherTeams'\) \? cardChipsTeams\(teams, t\.otherTeams, 'otherTeams'\) : cardChipsStatic\(t\.otherTeams\)/);
  assert.match(modal, /span2: true, editKey: e \? '' : 'otherTeams'/);
  assert.match(modal, /#task-detail-overlay \[data-k\], #task-detail-overlay \[data-toggle\]/);
  assert.match(modal, /control\.dataset\.k === cardState\.entryField \|\| control\.dataset\.toggle === cardState\.entryField/);
  assert.match(modal, /#task-detail-overlay \[data-k="' \+ key \+ '"\], #task-detail-overlay \[data-toggle="' \+ key \+ '"\]/);
});

test('inline-поле запускает штатную сессию редактирования с фокусом', () => {
  assert.match(modal, /cardStartEdit\(app, inlineEdit\.dataset\.inlineEdit\)/);
  assert.match(modal, /querySelector\('#task-detail-overlay \[data-k="' \+ key \+ '"\], #task-detail-overlay \[data-toggle="' \+ key \+ '"\]'\)/);
  assert.match(modal, /focusTarget\.focus\(\{ preventScroll: true \}\)/);
});

test('переход в режим редактирования сохраняет позицию прокрутки карточки', () => {
  assert.match(modal, /const cardBodyScrollTop = document\.getElementById\('mbody'\)\?\.scrollTop \|\| 0;[\s\S]*?cardRender\(\);[\s\S]*?renderedCardBody\.scrollTop = cardBodyScrollTop/);
  const focusFunction = modal.match(/function cardFocusEditField\(key\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(focusFunction, /scrollIntoView/);
});

test('inline-редактирование доступно с клавиатуры', () => {
  assert.match(modal, /role="button" tabindex="0"/);
  assert.match(modal, /e\.key !== 'Enter' && e\.key !== ' '/);
});

test('в режиме просмотра inline-поля имеют явное hover/focus-состояние', () => {
  assert.match(styles, /\.task-detail-modal:not\(\.editing\) \.inline-edit-target:hover/);
  assert.match(styles, /\.inline-edit-target:focus-visible/);
});

test('маркеры редактирования справа и выровнены по центру любого поля', () => {
  assert.match(styles, /\.inline-edit-target::after\{[\s\S]*?top:50%;[\s\S]*?right:8px;[\s\S]*?transform:translateY\(-50%\)/);
  assert.match(styles, /\.inline-edit-target:focus-visible::after\{[\s\S]*?transform:translateY\(-50%\)/);
  assert.doesNotMatch(styles, /\.inline-edit-target::after\{[\s\S]*?top:8px;/);
});

test('подсветка inline-редактора охватывает значение, но не заголовок поля', () => {
  assert.match(modal, /<div class="ival' \+ \(o\.valueClass \? ' ' \+ o\.valueClass : ''\) \+ editAttrs \+ '>/);
  assert.match(modal, /<div class="fval' \+ editAttrs \+ '>/);
  assert.match(modal, /<div class="task-title-card"><div class="desc-label">/);
  assert.match(modal, /<div class="task-title-row' \+ titleEditAttrs \+ '>/);
  assert.match(modal, /<div class="desc-val' \+ descriptionEditAttrs \+ '>/);
  assert.doesNotMatch(modal, /class="icell [^']*' \+ editAttrs/);
});

test('замок располагается сразу после названия нередактируемого атрибута', () => {
  assert.match(styles, /\.icell>\.ilab>\.flt,[\s\S]*?\.field>\.flabel>\.flt,[\s\S]*?\.kl>\.flt\{flex:0 1 auto\}/);
  assert.match(modal, /<span class="flt">Оценки<\/span><span class="lk">/);
  assert.match(modal, /cardIcell\('Подразделение',[\s\S]*?\{ lock: true/);
});

test('поля исполнения имеют одинаковую высоту inline-области', () => {
  assert.match(modal, /assignee'[\s\S]*?valueClass: 'execution-inline-field'/);
  assert.match(modal, /team'[\s\S]*?valueClass: 'execution-inline-field'/);
  assert.match(styles, /\.task-detail-modal \.cl-grid\.duo \.ival\.execution-inline-field\{[\s\S]*?height:40px;[\s\S]*?min-height:40px;/);
  assert.match(styles, /\.task-detail-modal \.cl-grid\.exec>\.icell:not\(\.exec-grades\)>\.ival\{[\s\S]*?height:40px;[\s\S]*?min-height:40px;[\s\S]*?align-content:center;/);
});

test('прогресс редактируется слайдером с шагом 5% и плашкой над бегунком', () => {
  assert.match(modal, /function cardProgressEditor\(value\)[\s\S]*?class="progress-value" data-progress-value[\s\S]*?type="range" min="0" max="100" step="5" data-k="progress"/);
  assert.doesNotMatch(modal, /class="pnum"/);
  assert.match(modal, /setProperty\('--progress-position', v \+ '%'\)/);
  assert.match(styles, /\.progress-value\{[\s\S]*?position:absolute;[\s\S]*?left:clamp\(18px,var\(--progress-position\),calc\(100% - 18px\)\);/);
});

test('шкала прогресса имеет одинаковую ширину в просмотре и редактировании', () => {
  assert.match(styles, /\.pbar2\{[\s\S]*?width:55%;[\s\S]*?height:6px;/);
  assert.match(styles, /\.prog-edit\{[\s\S]*?width:55%;[\s\S]*?height:40px;/);
  assert.match(styles, /\.prog-edit input\[type=range\]\{width:100%;margin:0\}/);
});

test('панель изменений показывает контекст и не сохраняет пустую форму', () => {
  assert.match(modal, /id="card-change-summary" role="status" aria-live="polite"/);
  assert.match(modal, /saveButton\.disabled = !cardState\.dirty \|\| cardState\.saving/);
  assert.match(modal, /Сохранить · ' \+ changesCount/);
  assert.match(modal, /Отменить изменения/);
  assert.match(styles, /\.edit-change-summary/);
});

test('чип режима редактирования стоит перед кнопками шапки и имеет единую форму', () => {
  assert.match(modal, /<div class="row-actions">[\s\S]*?class="editbadge"[\s\S]*?class="editbadge-mark"[^>]*>' \+ cardIcon\('warning'\) \+ '<\/span>Редактирование[\s\S]*?'data-action': 'copy-link'[\s\S]*?'data-action': 'close'/);
  assert.match(modal, /warning: '<path d="M10\.3 3\.6[\s\S]*?M12 9v4M12 17h\.01/);
  assert.doesNotMatch(modal, /task-head-chip--type[\s\S]{0,200}<span class="editbadge"/);
  assert.match(styles, /\.editbadge\{[\s\S]*?height:24px;[\s\S]*?border-radius:6px;[\s\S]*?padding:3px 10px;/);
});

test('чип несохранённых изменений не дублируется в шапке карточки', () => {
  assert.doesNotMatch(modal, /id="card-unsaved-indicator"/);
  assert.doesNotMatch(modal, /updateHeaderUnsavedIndicator\('card-unsaved-indicator'/);
  assert.match(modal, /id="card-change-summary" role="status" aria-live="polite"/);
});

test('безопасные inline-поля сохраняются автоматически только при одном изменении', () => {
  assert.match(modal, /CARD_AUTO_SAVE_INLINE_FIELDS = new Set\(\['priority', 'deadline'\]\)/);
  assert.match(modal, /cardDiffChanges\(cardState\.current, cardState\.draft\)\.length === 1/);
  assert.doesNotMatch(modal, /CARD_AUTO_SAVE_INLINE_FIELDS = new Set\([^\n]*status/);
  assert.doesNotMatch(modal, /CARD_AUTO_SAVE_INLINE_FIELDS = new Set\([^\n]*assignee/);
});

test('быстрый режим показывает редактор только у выбранного поля', () => {
  assert.match(modal, /const edit = key => e && \(!cardState\.entryField \|\| cardState\.entryField === key\)/);
  for (const key of ['title', 'description', 'comment', 'status', 'priority', 'deadline', 'progress', 'effortDays', 'weightPercent', 'forecastPercent', 'assignee', 'team', 'customer', 'project', 'type']) {
    assert.match(modal, new RegExp(`edit\\('${key}'\\) \\?`));
  }
  assert.match(modal, /cardChipsTags\(tags, t\.tags, 'tags', edit\('tags'\)\)/);
  assert.match(modal, /const fullEdit = e && !cardState\.entryField/);
  assert.match(modal, /cardBodyRep\(\)/);
  assert.match(modal, /cardBodySys\(t, fullEdit\)/);
});

test('после сохранения доступна безопасная отмена с проверкой версии', () => {
  assert.match(modal, /async function cardUndoSavedChanges\(app, previousSnapshot, expectedTaskId = currentTask\?\.id\)/);
  assert.match(modal, /const patch = \{ version: currentTask\.version \|\| 0, client_request_id: newTaskRequestId\(\) \}/);
  assert.match(modal, /cardToastAction\([^;]*cardUndoSavedChanges\(app, previousSnapshot, savedTaskId\)/);
  assert.match(modal, /if \(!cardMatchesCurrentTask\(taskId\)\)/);
  assert.match(styles, /\.toast-action-btn/);
});

test('длинные поля можно сохранить по Ctrl\+Enter, Escape отменяет сессию', () => {
  assert.match(modal, /e\.key === 'Enter' && cardState\.editing/);
  assert.match(modal, /if \(e\.key === 'Escape' && cardState\.editing\)[\s\S]*?cardCancelEdit\(app\)/);
});

test('клик вне активного поля завершает быстрое редактирование', () => {
  assert.match(modal, /function cardQuickEditContains\(target\)/);
  assert.match(modal, /control\.closest\('\.ival, \.fval, \.task-title-row, \.desc-val, \.dict-search-control'\)/);
  assert.match(modal, /cardState\.editing && cardState\.entryField && !cardQuickEditContains\(e\.target\)/);
  assert.match(modal, /await cardCancelEdit\(app\)/);
  assert.match(modal, /clearTimeout\(_cardQuickSaveTimer\);\s*if \(cardState\.saving\)/);
});

test('поиск словаря находится первой строкой внутри combobox', () => {
  assert.match(modal, /panel\.className = 'dict-search-popover'/);
  assert.match(modal, /panel\.append\(search\);/);
  assert.match(modal, /panel\.append\(optionsList\);/);
  assert.match(modal, /select\.hidden = true/);
  assert.match(modal, /trigger\.className = 'dict-combobox-trigger ui-control'/);
  assert.match(modal, /focusTarget\.classList\.contains\('dict-combobox-trigger'\)/);
  assert.doesNotMatch(modal, /wrapper\.append\(search, select\)/);
  assert.match(styles, /\.dict-search-popover\[hidden\]\{display:none\}/);
});

test('фильтр исполнителей явно указывает на мою команду', () => {
  assert.match(modal, /showAll \? 'Только моя команда'/);
  assert.doesNotMatch(modal, /showAll \? 'Только команда'/);
});

test('выбор исполнителя расположен справа от аватара', () => {
  assert.match(modal, /uiAvatar\(\{ name: t\.assignee, size: 32, id: 'assigneeAva' \}\)/);
  assert.match(modal, /class="person-assignee-control"/);
  assert.match(modal, /set\('assigneeAva', el => \{ el\.outerHTML = uiAvatar\(/);
  assert.match(styles, /\.person-ival\{[\s\S]*?grid-template-columns:32px minmax\(0,1fr\);/);
  assert.match(styles, /\.person-assignee-control \.dict-combobox-trigger\{width:100%;min-width:0\}/);
});

test('бизнес-заказчик редактируется inline через поисковый справочник', () => {
  assert.match(modal, /cardIcell\(taskFormLabel\('customer'\)[\s\S]*?edit\('customer'\) \? taskFormEditControl\('customer', t\.customer\)/);
  assert.match(modal, /uiAvatar\(\{ name: t\.customer, size: 32, id: 'custAva' \}\)[\s\S]*?class="person-assignee-control"/);
  assert.match(modal, /editKey: e \? '' : 'customer'/);
  assert.match(modal, /selector: '\[data-k="customer"\]', label: 'Бизнес-заказчик'/);
  assert.match(modal, /business_customer_id: m\.customerId \? m\.customerId\(d\.customer\) : null/);
  assert.match(modal, /set\('custAva', el => \{ el\.outerHTML = uiAvatar\(/);
  assert.match(modal, /set\('custDept', el => \{ el\.textContent = t\.customerDept \|\| '—'; \}\)/);
  assert.match(modal, /if \(k === 'customer'\) \{[\s\S]*?cardState\.draft\.customerDept = cardCustomerDepartment\(v, ''\)/);
});

test('поля заказчика и канала имеют одинаковую высоту', () => {
  assert.match(modal, /customer'[\s\S]*?valueClass: 'customer-row-field'/);
  assert.match(modal, /channel'[\s\S]*?valueClass: 'customer-row-field'/);
  assert.match(styles, /\.task-detail-modal \.cl-grid\.duo \.ival\.customer-row-field\{[\s\S]*?height:40px;[\s\S]*?min-height:40px;/);
  assert.match(styles, /\.ival\.customer-row-field \.dict-combobox-trigger\{[\s\S]*?height:40px;[\s\S]*?min-height:40px;/);
  assert.match(styles, /\.task-detail-modal:not\(\.editing\) \.ival\.customer-row-field \.person-assignee-control,[\s\S]*?\.ival\.customer-row-field>#custDept\{[\s\S]*?display:flex;[\s\S]*?align-items:center;[\s\S]*?height:30px;/);
});

test('вторая строка атрибутов команды и заказчика начинается на одном уровне', () => {
  assert.match(styles, /\.cl-grid\.duo\{[\s\S]*?grid-template-rows:56px minmax\(56px,1fr\);/);
  assert.match(modal, /Другие вовлечённые команды[\s\S]*?taskFormLabel\('channel'\)[\s\S]*?taskFormLabel\('receivedAt'\)/);
});

test('подразделение выводится справа от бизнес-заказчика, а оценки — в исполнении', () => {
  assert.match(modal, /cardIcell\(taskFormLabel\('customer'\)[\s\S]*?cardIcell\('Подразделение', cardCustomerReference\('customerDeptId'/);
  assert.doesNotMatch(modal, /person-sub" id="custDept"/);
  assert.match(modal, /cl-grid exec[\s\S]*?class="icell exec-grades"[\s\S]*?<span class="flt">Оценки<\/span>/);
  assert.match(styles, /\.cl-grid\.exec \.exec-grades\{grid-column:1\/-1\}/);
});

test('поля проекта и типа задачи имеют одинаковую высоту', () => {
  assert.match(modal, /project'[\s\S]*?valueClass: 'classification-inline-field'/);
  assert.match(modal, /type'[\s\S]*?valueClass: 'classification-inline-field'/);
  assert.match(styles, /\.task-detail-modal \.ival\.classification-inline-field\{[\s\S]*?height:40px;[\s\S]*?min-height:40px;/);
  assert.match(styles, /\.classification-inline-field \.dict-combobox-trigger\{[\s\S]*?height:40px;[\s\S]*?min-height:40px;/);
});

test('кнопки расчёта вызывают backend-интеграцию приоритизатора', () => {
  assert.match(modal, /function cardPrioritiserButton\(kind\)/);
  assert.match(modal, /async function cardRunPrioritiser\(kind, app\)/);
  assert.match(modal, /api\.post\(`\/tasks\/\$\{taskId\}\/prioritiser\/\$\{kind\}`/);
  assert.match(modal, /_taskCardRequestGate\.start\('prioritiser-calculation', taskId\)/);
  assert.match(modal, /\{ signal: request\.signal \}/);
  assert.match(modal, /_taskCardRequestGate\.isCurrent\(request\.token, taskId\)/);
  assert.match(modal, /if \(a === 'ai-calc-fin'\) \{ await cardRunPrioritiser\('value', app\); return; \}/);
  assert.match(modal, /if \(a === 'ps-calc'\) \{ await cardRunPrioritiser\('priority', app\); return; \}/);
  assert.doesNotMatch(modal, /function cardAiSuggest\(/);
  assert.doesNotMatch(modal, /function cardPsSuggest\(/);
});

test('финансовый эффект сохраняется только после принятия предложения агента', () => {
  assert.match(modal, /function cardRenderPrioritiserValueProposal\(\)/);
  assert.match(modal, /Number\.isFinite\(valueMln\)/);
  assert.match(modal, /Агент вернул некорректный финансовый эффект/);
  assert.match(modal, /'data-action': 'ai-value-reject'/);
  assert.match(modal, /'data-action': 'ai-value-accept'/);
  assert.match(modal, /Финансовый эффект рассчитан\. Проверьте и примите результат\./);
  assert.match(modal, /prioritiser\/value\/approve/);
  assert.match(modal, /if \(a === 'ai-value-accept'\) \{ await cardAcceptPrioritiserValue\(app\); return; \}/);
  assert.match(modal, /if \(a === 'ai-value-reject'\) \{[\s\S]*?cardAi = null;[\s\S]*?Предложение агента отклонено/);
});

test('карточка не подменяет ответ агента legacy AI-полями и не отправляет agent-managed поля в общий PATCH', () => {
  assert.match(modal, /function cardEffectiveFin\(t\) \{ return t\.finEffect; \}/);
  assert.match(modal, /function cardEffectiveFinJust\(t\) \{ return t\.finJust \|\| ''; \}/);
  assert.doesNotMatch(modal, /finEffectAi|finJustAi/);
  const payload = modal.match(/function cardPayload\(source = cardState\.draft\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(payload, /financial_effect_ai|priority_score|priority_justification/);
  assert.doesNotMatch(modal, /cardTaC\('priorityJust'/);
});

test('кнопки агентов показывают чек-лист обязательных полей на русском', () => {
  assert.match(modal, /const CARD_PRIORITISER_REQUIREMENTS = \{/);
  for (const label of ['ID задачи', 'Тип задачи', 'Ответственная команда', 'Название задачи', 'Оценка трудозатрат, ч\/д', 'Бизнес-заказчик', 'Срок выполнения']) {
    assert.match(modal, new RegExp(label));
  }
  assert.match(modal, /class="agent-check-tooltip"[^>]*role="tooltip"/);
  assert.match(modal, /'aria-describedby': tooltipId/);
  assert.match(modal, /bindTooltip\(\{ trigger, panel \}\)/);
  assert.match(styles, /\.agent-check-item\.ready \.agent-check-mark/);
  assert.match(styles, /\.agent-check-item\.missing \.agent-check-mark/);
});

test('неполные данные агента показываются в устойчивом модальном окне', () => {
  assert.match(modal, /function showPrioritiserRequirementsModal\(kind, items\)/);
  assert.match(modal, /role="dialog" aria-modal="true"/);
  assert.match(modal, /const host = document\.getElementById\('task-detail-overlay'\) \|\| document\.body;[\s\S]*?host\.appendChild\(overlay\)/);
  assert.match(modal, /if \(requirements\.some\(item => !item\.filled\)\) \{[\s\S]*?showPrioritiserRequirementsModal\(kind, requirements\);[\s\S]*?return;/);
  assert.match(modal, /Array\.isArray\(missing\) && missing\.length[\s\S]*?showPrioritiserRequirementsModal\(kind, cardPrioritiserRequirements\(kind, missing\)\)/);
  assert.doesNotMatch(modal, /Не хватает данных: ' \+ missing\.join/);
  assert.match(styles, /\.prioritiser-requirements-modal\{/);
});

test('разделители KPI-карточек совпадают по высоте в режиме редактирования', () => {
  assert.match(modal, /if \(e\) h \+= '[\s\S]*?<div class="psbar hide"><\/div><div class="bc-div"><\/div>/);
  assert.match(styles, /\.bc-value\{[\s\S]*?min-height:44px;[\s\S]*?display:flex;[\s\S]*?align-items:center;/);
});

test('Priority Score и финансовый эффек растягиваются до одной высоты', () => {
  assert.match(styles, /\.psrow\{[\s\S]*?grid-template-columns:1fr 1fr;[\s\S]*?align-items:stretch;/);
  assert.match(styles, /\.bigcard\{[\s\S]*?display:flex;[\s\S]*?flex-direction:column;[\s\S]*?height:100%;[\s\S]*?box-sizing:border-box;/);
});

test('лог задачи преобразует ID справочников в названия и обновляется при открытии', () => {
  assert.match(modal, /const CARD_HISTORY_REFERENCE_KEYS = \{/);
  assert.match(modal, /priority_id: 'priorities'/);
  assert.match(modal, /const oldValue = cardHistoryValue\(r\.field_name, r\.old_value\)/);
  assert.match(modal, /if \(validTab === 'log'\) await cardLoadHistory\(app\)/);
});

test('вкладка ссылок показывает файлы перед системной информацией', () => {
  assert.match(modal, /\['sys', 'Ссылки и файлы', 'link'\]/);
  assert.match(modal, /function cardBodySys[\s\S]*?h \+= cardBodyFiles\(\);[\s\S]*?h \+= cardSec\('Системная информация'/);
  assert.match(modal, /cardState\.tab === 'sys'\) h = cardBodySys\(t, fullEdit\);/);
});

test('legacy files канонизируется в sys во всех путях активации', () => {
  assert.match(modal, /export function normalizeTaskCardTab\(tab\) \{[\s\S]*?tab === 'files' \? 'sys' : tab/);
  assert.match(modal, /function cardTabFromRoute\(\) \{[\s\S]*?return normalizeTaskCardTab\(requested\)/);
  const activationStart = modal.indexOf('async function cardActivateTab');
  const activationEnd = modal.indexOf('function cardIcon', activationStart);
  const activation = modal.slice(activationStart, activationEnd);
  assert.match(activation, /const validTab = normalizeTaskCardTab\(tab\)/);
  assert.match(activation, /return validTab/);
  assert.doesNotMatch(activation, /validTab === 'files'/);
});

test('число файлов обновляет вкладку и список после загрузки данных', () => {
  const loadStart = modal.indexOf('async function loadAttachments');
  const loadEnd = modal.indexOf('async function uploadFile', loadStart);
  const loadAttachments = modal.slice(loadStart, loadEnd);
  assert.match(loadAttachments, /cardState\.filesCount = _attachmentsCache\.length/);
  assert.match(loadAttachments, /cardRenderTabs\(\)/);
  assert.match(loadAttachments, /renderAttachmentsList\(\)/);
  assert.match(modal, /if \(x\[0\] === 'sys'\) return 'Ссылки и файлы' \+ \(cardState\.filesCount/);
  assert.match(modal, /function cardHydrateAttachments\(\)[\s\S]*?renderAttachmentsList\(\);[\s\S]*?initAttachmentForm\(currentTask\.id, window\.app\)/);
  assert.doesNotMatch(modal, /cardState\.tab === 'files'\) h = cardBodyFiles\(\)/);
});

test('зона загрузки файлов доступна с клавиатуры и имеет явное имя', () => {
  const filesStart = modal.indexOf('function cardBodyFiles');
  const filesEnd = modal.indexOf('function cardHydrateAttachments', filesStart);
  const filesBody = modal.slice(filesStart, filesEnd);
  assert.match(filesBody, /id="attachment-drop-zone"[^>]*role="button"[^>]*tabindex="0"[^>]*aria-label="Добавить файлы к задаче"[^>]*aria-describedby="attachment-drop-hint"/);
  assert.match(filesBody, /<svg aria-hidden="true"/);
  assert.match(filesBody, /id="attachment-file-input"[^>]*class="attachment-file-input-hidden"[^>]*tabindex="-1"[^>]*aria-hidden="true"/);
  assert.match(modal, /dropZone\.addEventListener\('keydown', \(e\) => \{[\s\S]*?e\.key !== 'Enter' && e\.key !== ' '[\s\S]*?fileInput\.click\(\)/);
  assert.match(styles, /\.attachment-drop-zone:focus-visible[\s\S]*?outline: 2px solid var\(--accent\)/);
});

test('вкладки реализуют ARIA tab pattern и клавиатурную навигацию', () => {
  assert.match(modal, /id="tabs" role="tablist" aria-label="Разделы карточки задачи" aria-orientation="horizontal"/);
  assert.match(modal, /uiTab\(\{ id: 'task-tab-' \+ x\[0\], label: label\(x\), panelId: 'mbody', selected/);
  assert.match(modal, /el\.setAttribute\('role', 'tabpanel'\)/);
  assert.match(modal, /el\.setAttribute\('aria-labelledby', 'task-tab-' \+ cardState\.tab\)/);
  for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) assert.match(modal, new RegExp(`'${key}'`));
  assert.match(modal, /tabNavigationTarget\(document\.getElementById\('tabs'\), e\)/);
  assert.match(modal, /const activeTab = await cardActivateTab\(nextTab\.dataset\.tab, app\)/);
  assert.match(modal, /document\.getElementById\('task-tab-' \+ activeTab\)\?\.focus/);
  assert.match(modal, /async function cardConfirmTabChange\(nextTab\)[\s\S]*?confirmTaskCardDiscard/);
  assert.equal((modal.match(/await cardConfirmTabChange\(/g) || []).length, 3);
});

test('диалог получает доступное имя от единственного активного заголовка', () => {
  assert.match(modal, /role="dialog" aria-modal="true" aria-labelledby="task-detail-title"/);
  assert.match(modal, /<h1 class="head-title" id="task-detail-title"/);
  const bodyStart = modal.indexOf('function cardBodyMainV30');
  const bodyEnd = modal.indexOf('function cardEffortTable', bodyStart);
  assert.doesNotMatch(modal.slice(bodyStart, bodyEnd), /<h1 class="task-title"/);
});

test('описание рендерится безопасным Markdown и длинный текст можно раскрыть', () => {
  assert.match(modal, /import \{ renderTaskCardMarkdown \} from '\.\.\/taskCardMarkdown\.js'/);
  assert.match(modal, /renderTaskCardMarkdown\(t\.description\)/);
  assert.match(modal, /class="ui-link task-description-toggle" data-action="toggle-description"/);
  assert.match(modal, /content\.scrollHeight > collapsedHeight \+ 1/);
  assert.match(modal, /button\.textContent = cardState\.descriptionExpanded \? 'Свернуть' : 'Показать полностью'/);
  assert.match(modal, /if \(ev\.target\.closest\('\.task-description-content a'\)\) return/);
  assert.match(modal, /if \(e\.target\.closest\?\.\('\.task-description-content a'\)\) return/);
  assert.match(styles, /\.task-description-shell\.is-collapsible:not\(\.is-expanded\) \.task-description-content\{[\s\S]*?max-height:var\(--task-description-collapsed-height\);[\s\S]*?overflow:hidden/);
});

test('переполнение вкладок обозначено градиентами и явными кнопками прокрутки', () => {
  assert.match(modal, /id="task-tabs-shell"/);
  assert.match(modal, /data-action="scroll-tabs-left" aria-label="Прокрутить вкладки влево"/);
  assert.match(modal, /data-action="scroll-tabs-right" aria-label="Прокрутить вкладки вправо"/);
  assert.match(modal, /tabs\.scrollWidth - tabs\.clientWidth/);
  assert.match(styles, /\.tabs-shell::before,[\s\S]*?\.tabs-shell::after/);
  assert.match(styles, /\.tabs-shell\.can-scroll-left::before,[\s\S]*?\.tabs-shell\.can-scroll-right::after\{opacity:1\}/);
});

test('подписи полей читаемы без избыточного капса, пассивные рамки ослаблены', () => {
  assert.match(styles, /\.desc-label\{[\s\S]*?font-size:12px;[\s\S]*?text-transform:none/);
  assert.match(styles, /\.ilab\{[\s\S]*?font-size:12px;[\s\S]*?text-transform:none/);
  assert.match(styles, /\.flabel,[\s\S]*?\.kl\{[\s\S]*?font-size:12px/);
  assert.match(styles, /\.field,\.stats,\.bigcard\{background:var\(--bg-secondary\);border-color:transparent\}/);
});
