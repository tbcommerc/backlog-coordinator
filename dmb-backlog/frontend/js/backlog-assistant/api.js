const BASE = '/backlog-assistant';
export function assistantApi(api) {
    return {
        capabilities: () => api.get(`${BASE}/capabilities`),
        sessions: () => api.get(`${BASE}/sessions`),
        session: id => api.get(`${BASE}/sessions/${encodeURIComponent(id)}`),
        create: (context, key) => api.post(`${BASE}/sessions`, { context }, { idempotencyKey: key }),
        message: (id, body, key) => api.post(`${BASE}/sessions/${encodeURIComponent(id)}/messages`, body, { idempotencyKey: key }),
        run: id => api.get(`${BASE}/runs/${encodeURIComponent(id)}`, { passive: true }),
        cancel: id => api.post(`${BASE}/runs/${encodeURIComponent(id)}/cancel`, {}),
        remove: id => api.delete(`${BASE}/sessions/${encodeURIComponent(id)}`),
        result: (id, cursor = 0) => api.get(`${BASE}/results/${encodeURIComponent(id)}?cursor=${cursor}`),
        patch: (id, body) => api.patch(`${BASE}/sessions/${encodeURIComponent(id)}`, body),
        feedback: (id, rating) => api.post(`${BASE}/messages/${encodeURIComponent(id)}/feedback`,
            { rating, reason_code: rating > 0 ? 'helpful' : 'incorrect', comment: '' }),
    };
}
