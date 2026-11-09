// A filter's cardinality is a product decision, independent of its HTML widget.
export const FILTER_POLICIES = [
 {selector:'[data-backlog-scope]',mode:'single',reason:'Одна область данных all/team; team закрепляет свою команду, all допускает множественный командный фильтр'},
 {selector:'#quarterly-filters [name=team_id],#quarterly-filters [name=owner_id],#quarterly-filters [name=project_id],#quarterly-filters [name=metric_state],#quarterly-filters [name=period_state]',mode:'multiple',reason:'ИЛИ внутри категорий квартального реестра; И между полями'},
 {selector:'#quarterly-filters [name=year],#quarterly-filters [name=quarter],#quarterly-filters [name=view],#quarterly-filters [name=scope]',mode:'single',reason:'Единый календарный контекст и область реестра'},
 {selector:'#metric-filters select:not([name=period]), select[form=metric-filters][name=sort]',exclude:'[name=q],[name=sort]',mode:'multiple',reason:'Отбор метрик по любому из выбранных значений'},
 {selector:'#work-status,#work-priority,#work-direction,#work-team,#work-assignee,#work-filter-project,#work-focus',mode:'multiple',reason:'Объединение выбранных статусов, приоритетов, направлений, команд, исполнителей, проектов и быстрых выборок'},
 {selector:'.admin-user-filter,.admin-list-filter,.audit-filter,[id^=audit-filter-]',mode:'multiple',reason:'Сопоставление нескольких категорий записей в одном реестре'},
 {selector:'#effort-team,#profile-channel,#dep-type,#sankey-channel,#roi-team,#roi-type,#effort-period,#profile-period,#dep-period,#sankey-period,#roi-period,#complete-period,#p360-flow-period,#p360-flow-channel',mode:'multiple',reason:'Срез аналитики по объединению категорий и периодов; каждая задача учитывается один раз'},
 {selector:'[data-reporting-team],[data-reporting-readiness],[data-team-weekly-team]',mode:'multiple',reason:'Просмотр статусов нескольких команд и состояний готовности; права редактирования проверяются отдельно для каждой задачи'},
 {selector:'#customer-status-filter,#review-status-filter,#review-mode-filter,#review-team_ids,#review-customer_ids,#review-coordinator_ids,[data-directorate-filter],[data-meeting-filter=kind],[data-meeting-filter=state]',mode:'multiple',reason:'Объединение выбранных категорий и очередей ответственности в списке'},
 {selector:'#work-report-team',mode:'multiple',reason:'Сводка по нескольким доступным командам'},
 {selector:'#metric-filters [name=period],.metric-period-bar [name=period_id],#did-quarter,#work-done-period,#work-completed',mode:'single',reason:'Единый временной контекст: значения, цели и показатели рассчитываются для одного периода или одного вложенного временного окна'},
 {selector:'[name=sort],#work-sort,#review-sort,#customer-request-sort',mode:'single',reason:'Одна явно выбранная схема упорядочения результата'},
 {selector:'#work-view,#work-attention,#dep-mode,#dep-threshold,#sankey-mode,#uniform-field',mode:'single',reason:'Один режим расчёта, группировки или рабочий контекст; совместный выбор единиц расчёта или вложенных порогов не определяет дополнительного результата'},
 {selector:'#work-report-meeting',mode:'single',reason:'Один снимок встречи: объединение снимков разных дат дублировало бы задачи и смешивало версии статусов'},
];
export function filterPolicy(select) {
 return FILTER_POLICIES.find(policy=>select.matches(policy.selector)&&(!policy.exclude||!select.matches(policy.exclude))) ||
  {mode:select.multiple?'multiple':'single',reason:select.dataset.uiSingleReason || 'Не классифицировано'};
}
