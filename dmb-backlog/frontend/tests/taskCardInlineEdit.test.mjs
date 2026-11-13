import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const modal = readFileSync(new URL('../js/components/modal.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../css/components.css', import.meta.url), 'utf8');
const compositionStyles = readFileSync(new URL('../css/ui/task-detail-composition.css', import.meta.url), 'utf8');
const secondaryStyles = readFileSync(new URL('../css/ui/task-secondary-composition.css', import.meta.url), 'utf8');


test('другие вовлечённые команды доступны для быстрого редактирования', () => {
  assert.match(modal, /edit\('otherTeams'\) \? cardChipsTeams\(cardNameList\('teams'\), t\.otherTeams, 'otherTeams'\) : escapeHtml\(t\.otherTeams\.join/);
  assert.match(modal, /f\('Вовлечённые команды',[^\n]+, 'otherTeams'\)/);
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
  assert.match(compositionStyles, /\.ui-task-detail-field\[data-inline-edit\]:hover/);
  assert.match(compositionStyles, /\.ui-task-detail-field\[data-inline-edit\]:focus-visible/);
});

test('маркеры редактирования справа и выровнены по центру любого поля', () => {
  assert.match(styles, /\.inline-edit-target::after\{[\s\S]*?top:50%;[\s\S]*?right:8px;[\s\S]*?transform:translateY\(-50%\)/);
  assert.match(styles, /\.inline-edit-target:focus-visible::after\{[\s\S]*?transform:translateY\(-50%\)/);
  assert.doesNotMatch(styles, /\.inline-edit-target::after\{[\s\S]*?top:8px;/);
});




test('прогресс редактируется целым числом от 0 до 100 по референсу', () => {
  assert.match(modal, /f\('progress', 'Прогресс, %', cardNumC\('progress', t\.progress, 1, 100\)\)/);
  assert.match(modal, /!Number\.isInteger\(Number\(d\.progress\)\)/);
  assert.match(modal, /progress: Number\(d\.progress\)/);
});


test('панель изменений показывает контекст и не сохраняет пустую форму', () => {
  assert.match(modal, /id="card-change-summary" role="status" aria-live="polite"/);
  assert.match(modal, /saveButton\.disabled = !cardState\.dirty \|\| cardState\.saving/);
  assert.match(modal, /summary\.textContent = changesCount \? 'Не сохранено · ' \+ changesCount/);
  assert.match(modal, /label: 'Отменить',[^\n]+id: 'cardCancelBtn', 'data-action': 'cancel'/);
  assert.match(modal, /const label = 'Сохранить'/);
});

test('заголовок сохраняет название задачи при редактировании по референсу', () => {
  const header = modal.slice(modal.indexOf('function cardRenderHeader()'), modal.indexOf('function cardRenderTabs()'));
  assert.match(header, /<h1 class="ui-task-dialog-title" id="task-detail-title"[^\n]+escapeHtml\(cardState\.editing \? cardState\.current\.title : t\.title\)/);
  assert.match(header, /cardState\.editing \? uiBadge\(\{ label: 'Редактирование', tone: 'accent', className: 'ui-task-dialog-edit-badge'/);
  assert.doesNotMatch(modal, /Режим редактирования включён/);
});

test('чип несохранённых изменений не дублируется в шапке карточки', () => {
  assert.doesNotMatch(modal, /id="card-unsaved-indicator"/);
  assert.doesNotMatch(modal, /updateHeaderUnsavedIndicator\('card-unsaved-indicator'/);
  assert.match(modal, /id="card-change-summary" role="status" aria-live="polite"/);
});

test('inline-поля не имеют отдельного скрытого автосохранения', () => {
  assert.doesNotMatch(modal, /CARD_AUTO_SAVE_INLINE_FIELDS/);
  // Само отсутствие записи после change и Escape проверяет taskCardReliability.spec.mjs.
});

test('быстрый режим показывает редактор только у выбранного поля', () => {
  assert.match(modal, /if \(e && !cardState\.entryField\) return cardMainFullEditor\(t\)/);
  assert.match(modal, /const edit = key => e && cardState\.entryField === key/);
  for (const key of ['title', 'description', 'comment', 'status', 'priority', 'deadline', 'progress', 'effortDays', 'weightPercent', 'forecastPercent', 'assignee', 'team', 'customer', 'project', 'type']) {
    assert.match(modal, new RegExp(`edit\\('${key}'\\)|active\\('${key}'\\)|textControl\\('${key}'`));
  }
  assert.match(modal, /edit\('tags'\) \? cardChipsTags\(cardNameList\('tags'\), t\.tags, 'tags', true\)/);
  assert.match(modal, /const fullEdit = e && !cardState\.entryField/);
  assert.match(modal, /cardBodyRep\(\)/);
  assert.match(modal, /cardBodySys\(t, fullEdit\)/);
});

test('после сохранения доступна безопасная отмена с проверкой версии', () => {
  assert.match(modal, /async function cardUndoSavedChanges\(app, previousSnapshot, expectedTaskId = currentTask\?\.id, savedVersion = null\)/);
  assert.match(modal, /const patch = \{ version: savedVersion, client_request_id: newTaskRequestId\(\) \}/);
  assert.match(modal, /cardUndoSavedChanges\(app, previousSnapshot, savedTaskId, savedResponse\?\.version\)/);
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







test('кнопки расчёта вызывают backend-интеграцию приоритизатора', () => {
  assert.match(modal, /function cardPrioritiserButton\(kind, label = 'AI-расчёт'\)/);
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
  assert.match(modal, /document\.body\.appendChild\(overlay\);\s+enhanceDialogOverlay\(overlay, origin\)/);
  assert.match(modal, /if \(requirements\.some\(item => !item\.filled\)\) \{[\s\S]*?showPrioritiserRequirementsModal\(kind, requirements\);[\s\S]*?return;/);
  assert.match(modal, /Array\.isArray\(missing\) && missing\.length[\s\S]*?showPrioritiserRequirementsModal\(kind, cardPrioritiserRequirements\(kind, missing\)\)/);
  assert.doesNotMatch(modal, /Не хватает данных: ' \+ missing\.join/);
  assert.match(styles, /\.prioritiser-requirements-modal\{/);
});



test('лог задачи преобразует ID справочников в названия и обновляется при открытии', () => {
  assert.match(modal, /const CARD_HISTORY_REFERENCE_KEYS = \{/);
  assert.match(modal, /priority_id: 'priorities'/);
  assert.match(modal, /const oldValue = cardHistoryValue\(r\.field_name, r\.old_value\)/);
  assert.match(modal, /if \(validTab === 'log'\) await cardLoadHistory\(app\)/);
});

test('вкладка ссылок показывает файлы перед системной информацией', () => {
  assert.match(modal, /\['sys', 'Ссылки и файлы', 'link'\]/);
  assert.match(modal, /function cardBodySys[\s\S]*?h \+= cardBodyFiles\(\);[\s\S]*?h \+= uiSectionCard\(\{ title: 'Системная информация'/);
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
  assert.match(filesBody, /cardIcon\('upload'\)/);
  assert.match(modal, /function cardIcon\(n\)[\s\S]*?<svg[^>]*aria-hidden="true"/);
  assert.match(filesBody, /id="attachment-file-input"[^>]*class="attachment-file-input-hidden"[^>]*tabindex="-1"[^>]*aria-hidden="true"/);
  assert.match(modal, /dropZone\.addEventListener\('keydown', \(e\) => \{[\s\S]*?e\.key !== 'Enter' && e\.key !== ' '[\s\S]*?fileInput\.click\(\)/);
  assert.match(secondaryStyles, /\.ui-task-file-drop:focus-visible\{outline:2px solid var\(--accent\)/);
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
  assert.match(modal, /<h1 class="ui-task-dialog-title" id="task-detail-title"/);
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
