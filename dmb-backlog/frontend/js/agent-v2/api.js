export function requestKey(scope = 'agent-v2') {
  if (globalThis.crypto?.randomUUID) return `${scope}:${crypto.randomUUID()}`.slice(0, 128);
  return `${scope}:${Date.now()}:${Math.random().toString(16).slice(2)}`.slice(0, 128);
}

export class AgentV2ApiError extends Error {
  constructor(response, payload) {
    const detail = payload?.detail || payload?.error || {};
    const message = typeof detail === 'string' ? detail : detail.message;
    super(message || `HTTP ${response.status}`);
    this.status = response.status;
    this.code = detail.code || payload?.code || null;
    this.details = detail;
  }
}

export class AgentV2Api {
  constructor(app) {
    this.app = app;
    this.base = '/api/v2/agent';
  }

  async request(method, path, data = null) {
    const headers = { ...this.app.api.getHeaders(), Accept: 'application/json' };
    if (method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      headers['Idempotency-Key'] = data?.idempotency_key || requestKey(path);
    }
    const options = {
      method,
      headers,
      credentials: 'same-origin',
      body: data == null ? undefined : JSON.stringify(data),
    };
    let response = await fetch(`${this.base}${path}`, options);
    if (response.status === 401 && await this.app.api.refreshToken()) {
      options.headers = { ...headers, ...this.app.api.getHeaders() };
      response = await fetch(`${this.base}${path}`, options);
    }
    let payload = {};
    try { payload = await response.json(); } catch { /* empty error response */ }
    if (!response.ok) throw new AgentV2ApiError(response, payload);
    return payload;
  }

  get(path) { return this.request('GET', path); }
  post(path, data = {}) { return this.request('POST', path, data); }

  documentAction(state, action, data = {}) {
    return this.post('/document-action', {
      session_id: state.session_id,
      expected_draft_hash: state.draft?.fingerprint || '',
      action,
      idempotency_key: requestKey(action),
      ...data,
    });
  }
}

export function agentV2Api(app) {
  app._agentV2Api ||= new AgentV2Api(app);
  return app._agentV2Api;
}
