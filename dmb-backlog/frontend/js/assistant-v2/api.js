function idempotencyKey(scope = 'v2') {
  if (globalThis.crypto?.randomUUID) return `${scope}:${crypto.randomUUID()}`.slice(0, 64);
  return `${scope}:${Date.now()}:${Math.random().toString(16).slice(2)}`.slice(0, 64);
}

export class AssistantV2ApiError extends Error {
  constructor(response, payload) {
    const error = payload?.error || payload?.detail || {};
    super(error.message || `HTTP ${response.status}`);
    this.status = response.status;
    this.code = error.code || null;
    this.details = error.details || error;
  }
}

export class AssistantV2Api {
  constructor(app) {
    this.app = app;
    this.base = '/api/v2/assistant';
  }

  async request(method, path, data = null, options = {}) {
    const headers = { ...this.app.api.getHeaders(), Accept: 'application/json' };
    if (method !== 'GET') headers['Idempotency-Key'] = options.idempotencyKey || idempotencyKey(options.scope);
    const request = {
      method,
      headers,
      credentials: 'same-origin',
      body: data == null ? undefined : JSON.stringify(data),
      signal: options.signal,
    };
    let response = await fetch(`${this.base}${path}`, request);
    if (response.status === 401 && await this.app.api.refreshToken()) {
      request.headers = { ...headers, ...this.app.api.getHeaders() };
      response = await fetch(`${this.base}${path}`, request);
    }
    let payload = null;
    try { payload = await response.json(); } catch { payload = {}; }
    if (!response.ok) throw new AssistantV2ApiError(response, payload);
    return payload;
  }

  get(path, options) { return this.request('GET', path, null, options); }
  post(path, data, options) { return this.request('POST', path, data, options); }
}

export function assistantV2Api(app) {
  app._assistantV2Api ||= new AssistantV2Api(app);
  return app._assistantV2Api;
}

export { idempotencyKey };

