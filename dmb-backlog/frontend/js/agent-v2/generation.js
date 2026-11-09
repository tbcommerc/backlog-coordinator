// Transfer coverage is distinct from business review and human approval.
const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');

export function sectionPresentation(state, field, value) {
  const generation = state.document_generation || {};
  const assessment = !generation.stale ? generation.section_states?.[field] : null;
  if (assessment?.status === 'conflict') return { label: 'Есть противоречие', empty: assessment.reason };
  if (value) {
    const confirmed = state.draft?.field_provenance?.[field]?.confirmed;
    return { label: confirmed ? 'Проверено аналитиком' : 'Требуется подтверждение', empty: '' };
  }
  // Missing input and failed processing must not look like the same business gap.
  if (assessment?.status === 'missing_data' && generation.status !== 'unverified') return { label: 'Нет данных в источнике', empty: assessment.reason };
  if (assessment?.status === 'not_applicable' && generation.status !== 'unverified') return { label: 'Не применимо · подтвердите', empty: assessment.reason };
  if (assessment?.status === 'unprocessed') return { label: 'Не удалось обработать', empty: 'Раздел не оценён при генерации. Повторите проверку документа.' };
  return { label: 'Не заполнено', empty: 'Раздел не заполнен. Проверьте исходные материалы.' };
}

export function renderGenerationReport(state, labels = {}) {
  const generation = state.document_generation || {};
  const review = state.document_review || {};
  const freshReview = !review.stale && review.base_fingerprint === state.draft?.fingerprint && review.transfer_check;
  const report = freshReview || generation;
  if (!report.status) return '';
  const title = report.stale ? 'Проверка переноса устарела' : ({ complete: 'Перенос источников проверен', partial: 'Есть замечания к переносу источников', unverified: 'Перенос источников не проверен' })[report.status] || 'Проверка переноса';
  const parsing = report.source_parsing;
  const parseSummary = report.stale ? '' : `<p><strong>Разбор источника:</strong> ${parsing ? `${parsing.status === 'complete' ? 'все строки учтены' : 'требует проверки'} · ${parsing.accounted_lines} из ${parsing.nonempty_lines} непустых строк; неразобранных: ${parsing.unresolved?.length || 0}.` : 'отдельная проверка не выполнялась.'}</p>`;
  const count = !report.stale && Number.isInteger(report.facts_covered) ? `<p><strong>Перенос в документ:</strong> подтверждён перенос ${report.facts_covered} из ${report.facts_total} выделенных фрагментов. Это не подтверждает полноту исходных материалов и не означает согласование документа.</p>` : '';
  const issues = report.stale ? '' : (report.issues || []).map(item => `<li>${esc(labels[item.field] || 'Исходные данные')}: ${esc(item.message)}${item.quote ? `<blockquote>${esc(item.quote)}</blockquote>` : ''}</li>`).join('');
  const questions = report.stale ? '' : (report.questions || []).map(item => `<li><strong>${item.origin === 'author' ? 'Вопрос автора' : 'Вопрос помощника'}</strong> · ${esc(({ blocking: 'Мешает согласованию', behavior: 'Влияет на поведение', optional: 'Дополнительное уточнение' })[item.priority] || '')}<p>${esc(item.text)}</p><p>${esc(item.reason)}${item.removed ? ' · Исключён из списка при генерации' : item.decision !== 'keep' ? ' · Рекомендуется пересмотреть' : ''}</p></li>`).join('');
  return `<aside class="agent-v2-transfer" aria-label="Полнота переноса"><strong>${esc(title)}</strong>${parseSummary}${report.stale ? '<p>Документ или материалы изменились. Повторите проверку.</p>' : count}${issues ? `<details><summary class="ui-disclosure-text">Замечания к разбору и переносу: ${(report.issues || []).length}</summary><ul>${issues}</ul></details>` : ''}${questions ? `<details><summary class="ui-disclosure-text">Проверка вопросов</summary><ul>${questions}</ul></details>` : ''}</aside>`;
}
