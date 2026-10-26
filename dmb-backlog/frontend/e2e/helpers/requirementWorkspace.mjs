export const initialDraft = { title: 'Обработка заявки', problem_statement: 'Клиент ждёт обработки', business_goal: 'Сократить время обработки', scope_in: 'Заявки клиентов', acceptance_criteria: ['Оператор получает подтверждение отправки заявки'], revision: 1, fingerprint: 'h1', business_requirements: [{ id: 'BR-001', text: 'Сократить ожидание клиента', source_refs: ['src-1'] }] };
export async function mockWorkspace(page, { degraded = false, staleApply = false, humanPermissions = null, humanStatus = 'submitted' } = {}) {
  const calls = [];
  let state = { session_id: 'doc-1', artifact_id: 'artifact-1', product_mode: 'requirement_copilot', artifact_type: 'business_requirement_v2', operator_role: 'BA', phase: 'draft_ready', draft: structuredClone(initialDraft), slots: {}, history: [], readiness: { ready: false }, document_sources: [{ id: 'src-1', version: 1, title: 'Интервью', content: 'Клиент ждёт обработки', source_type: 'text' }], document_findings: [], document_proposals: [] };
  let humanReview = { id: 45, title: 'Обработка заявки', artifact_id: 'artifact-1', artifact_revision: 1, artifact_fingerprint: humanStatus === 'approved' ? 'h1' : 'previous', artifact_snapshot: structuredClone(initialDraft), creator_id: 10, creator_name: 'Автор запроса', reviewer_id: 11, reviewer_name: 'Ревьюер', session_id: 'doc-1', status: humanStatus, version: 3, comment: '', events: [], permissions: humanPermissions || { can_claim: false, can_approve: true, can_return: true, can_withdraw: false, can_open_workspace: false }, available_actions: ['approve', 'return'] };
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().postDataJSON();
    calls.push({ path, body });
    if (path === '/api/v2/agent/sessions') return json(route, { sessions: [{ session_id: state.session_id, title: state.draft?.title || initialDraft.title, updated_at: '2026-10-09T14:43:11+00:00', product_mode: state.product_mode, has_draft: Boolean(state.draft) }, { session_id: 'doc-2', title: 'Второе требование', product_mode: 'requirement_copilot', updated_at: '2026-10-09T14:00:00Z' }] });
    if (path === '/api/v2/agent/session/doc-2') return json(route, { ...state, session_id: 'doc-2' });
    if (path === '/api/v2/agent/session/doc-1') return json(route, state);
    if (path === '/api/v2/agent/edit-draft-section') { state.draft[body.field] = body.value; state.draft.revision += 1; state.draft.fingerprint = `h${state.draft.revision}`; return json(route, { ...state, action: 'draft_ready' }); }
    if (path === '/api/v2/agent/new-session') { state.draft = null; state.document_sources = []; state.document_proposals = []; state.document_findings = []; state.document_review = null; return json(route, state); }
    if (path === '/api/v2/agent/import-requirement-document') { state.draft = structuredClone(initialDraft); return json(route, state); }
    if (path === '/api/v2/agent/document-action') {
      if (body.action === 'save_sections') {
        if (body.expected_draft_hash !== (state.draft?.fingerprint || '')) return json(route, { detail: { code: 'revision_conflict', message: 'Документ изменился' } }, 409);
        state.draft ||= structuredClone(initialDraft);
        Object.assign(state.draft, body.sections); state.draft.revision += 1; state.draft.fingerprint = `h${state.draft.revision}`;
        if (state.document_review) state.document_review.stale = true;
      }
      if (body.action === 'create_draft') state.draft = structuredClone(initialDraft);
      if (body.action === 'dismiss_proposal') state.document_proposals[0].status = 'rejected';
      if (body.action === 'review') {
        state.document_review = { id: 'review-1', base_fingerprint: state.draft.fingerprint, revision: state.draft.revision, status: degraded ? 'degraded' : 'completed', stale: false };
        state.document_findings = [{ id: 'finding-1', base_fingerprint: state.draft.fingerprint, field: 'business_goal', quote: 'Сократить время', message: 'Не определено целевое время', risk: 'Нельзя измерить достижение цели', method: 'llm', severity: 'warning', status: 'open', sources: ['src-1'] }];
      }
      if (body.action === 'add_source') {
        state.document_sources.push({ ...body.source, id: `src-${state.document_sources.length + 1}`, version: 1 });
        if (state.document_review) state.document_review.stale = true;
      }
      if (body.action === 'resolve_finding') { state.document_findings[0].status = body.decision; state.document_findings[0].reason = body.reason; }
      if (['draft', 'propose_change'].includes(body.action)) state.document_proposals = [{ id: 'proposal-1', base_fingerprint: state.draft?.fingerprint || '', status: 'proposed', operations: [{ id: 'op-1', field: 'business_goal', before: state.draft?.business_goal || '', after: 'Сократить обработку до 15 минут', reason: 'Предложение для подтверждения', status: 'proposed', source_refs: ['src-1'] }, { id: 'op-2', field: 'scope_in', before: state.draft?.scope_in || '', after: 'Только онлайн-заявки', reason: 'Уточнить границы', status: 'proposed' }] }];
      if (body.action === 'apply_proposal') {
        if (staleApply) { state.draft = { ...state.draft, fingerprint: 'external', revision: 2 }; return json(route, { detail: { code: 'stale', message: 'Редакция изменилась' } }, 409); }
        state.draft ||= structuredClone(initialDraft);
        for (const op of state.document_proposals[0].operations) if (body.operation_ids.includes(op.id)) { state.draft[op.field] = op.after; op.status = 'applied'; }
        state.draft.revision += 1; state.draft.fingerprint = `h${state.draft.revision}`;
        state.document_proposals[0].status = body.operation_ids.length === 2 ? 'applied' : 'partially_applied';
        state.document_proposals[0].base_fingerprint = state.draft.fingerprint;
      }
      if (body.action === 'next_revision') { state.draft.revision += 1; state.draft.fingerprint = `h${state.draft.revision}`; state.phase = 'draft_ready'; }
      return json(route, state);
    }
    if (path === '/api/v2/agent/requirement-reviews') {
      humanReview = { ...humanReview, artifact_snapshot: structuredClone(state.draft), artifact_revision: state.draft.revision, review_report: { review: state.document_review, findings: state.document_findings, sources: state.document_sources, degraded_acknowledged: body.acknowledge_degraded_review } };
      return json(route, { review: humanReview, session_id: state.session_id, url: '#/review?tab=requirements&requirement_review=45' });
    }
    if (path === '/api/v2/agent/requirement-reviews/45/resume') return json(route, { state, session_id: state.session_id, review_id: 45 });
    if (path === '/api/requirement-reviews') return json(route, { items: [humanReview], total: 1 });
    if (path === '/api/requirement-reviews/45') return json(route, humanReview);
    if (path === '/api/requirement-reviews/45/actions') { humanReview.status = body.action === 'approve' ? 'approved' : body.action === 'return' ? 'returned' : humanReview.status; humanReview.comment = body.comment; humanReview.version += 1; humanReview.available_actions = []; return json(route, humanReview); }
    return json(route, { detail: `Unexpected ${path}` }, 404);
  });
  return { calls, getState: () => state };
}
