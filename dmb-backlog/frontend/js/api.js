/**
 * DMB Backlog - API Client
 * Handles all HTTP requests to backend
 */

/**
 * Custom error class for API errors
 */
export class APIError extends Error {
    constructor(message, status, code = null, data = null, rawText = null) {
        super(message);
        this.name = 'APIError';
        this.status = status;
        this.code = code;
        this.data = data;
        this.rawText = rawText;
    }

    isAuthError() {
        return this.status === 401;
    }

    isForbidden() {
        return this.status === 403;
    }

    isNotFound() {
        return this.status === 404;
    }

    isValidationError() {
        return this.status === 422;
    }

    isRateLimited() {
        return this.status === 429;
    }

    isServerError() {
        return this.status >= 500;
    }
}

export function parseServerSentEvent(block) {
    let event = 'message';
    const data = [];
    String(block || '').split(/\r?\n/).forEach(line => {
        if (line.startsWith('event:')) event = line.slice(6).trim() || 'message';
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    });
    if (!data.length) return null;
    try { return { event, data: JSON.parse(data.join('\n')) }; }
    catch { return null; }
}

export class API {
    constructor() {
        this.baseURL = '/api/v1';
        this.accessToken = null;
        this._refreshPromise = null;
        this.refreshChannel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('dmb-refresh-status') : null;
    }

    setAccessToken(token) {
        this.accessToken = token || null;
        if (!token && this.sessionWarningTimer) clearTimeout(this.sessionWarningTimer);
    }
    rememberSession(data) {
        if (!data?.session_expires_at) return;
        this.sessionExpiresAt = Date.parse(data.session_expires_at);
        this.lastBusinessActivity = Date.parse(data.last_activity_at);
        this.idleTimeout = data.idle_timeout_seconds * 1000;
        this.scheduleSessionWarning();
    }
    scheduleSessionWarning() {
        if (typeof window === 'undefined' || !this.sessionExpiresAt) return;
        clearTimeout(this.sessionWarningTimer);
        const remaining = Math.min(this.sessionExpiresAt, this.lastBusinessActivity + this.idleTimeout) - Date.now();
        this.sessionWarningTimer = setTimeout(() => window.dispatchEvent(new CustomEvent('account-session-expiring')),
            Math.max(0, remaining - 60000));
    }
    hasAccessToken() { return !!this.accessToken; }
    
    /**
     * @returns {Record<string, string>}
     */
    getHeaders() {
        const headers = {
            'Content-Type': 'application/json'
        };
        
        if (this.accessToken) {
            headers['Authorization'] = `Bearer ${this.accessToken}`;
        }
        
        return headers;
    }
    
    /**
     * @param {string} method
     * @param {string} path
     * @param {*} [data]
     * @returns {Promise<*>}
     */
    async request(method, path, data = null, requestOptions = {}) {
        const url = `${this.baseURL}${path}`;
        const options = {
            method,
            headers: this.getHeaders(),
            credentials: 'same-origin',
            signal: requestOptions.signal
        };
        if (requestOptions.idempotencyKey) options.headers['Idempotency-Key'] = requestOptions.idempotencyKey;
        
        if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
            if (data instanceof FormData) {
                delete options.headers['Content-Type'];
                options.body = data;
            } else {
                options.body = JSON.stringify(data);
            }
        }
        
        const response = await fetch(url, options);
        
        if (response.status === 401 && !path.startsWith('/auth/') && !path.startsWith('/admin/users') && !path.startsWith('/admin/roles')) {
            const refreshed = await this.refreshToken();
            if (refreshed) {
                options.headers = this.getHeaders();
                if (data instanceof FormData) delete options.headers['Content-Type'];
                if (requestOptions.idempotencyKey) options.headers['Idempotency-Key'] = requestOptions.idempotencyKey;
                const retryResponse = await fetch(url, options);
                return this.handleResponse(retryResponse);
            } else {
                this.setAccessToken(null);
                localStorage.removeItem('dmb_tokens');
                localStorage.removeItem('dmb_user');
                window.location.reload();
                throw new APIError('Authentication expired', 401);
            }
        }
        
        if (response.ok && !requestOptions.passive && !path.startsWith('/auth') && !path.startsWith('/notifications') && !path.startsWith('/events') && !/\/(status|heartbeat|viewers|lock)(\?|$)/.test(path)) {
            this.lastBusinessActivity = Date.now();
            this.scheduleSessionWarning();
        }
        return this.handleResponse(response);
    }
    
    /**
     * @param {Response} response
     * @returns {Promise<*>}
     */
    async handleResponse(response) {
        if (!response.ok) {
            let errorData = null;
            let rawText = null;
            try {
                rawText = await response.text();
                errorData = JSON.parse(rawText);
            } catch {
                errorData = { detail: `HTTP ${response.status}` };
            }
            const detail = errorData.detail;
            const message = detail && typeof detail === 'object'
                ? (detail.message || `HTTP ${response.status}`)
                : (detail || `HTTP ${response.status}`);
            throw new APIError(
                message,
                response.status,
                errorData.code || (detail && typeof detail === 'object' ? detail.code : null) || null,
                detail && typeof detail === 'object' ? detail : errorData,
                rawText
            );
        }
        
        // No Content responses may still carry an application/json header.
        if (response.status === 204) return null;

        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            return response.json();
        }
        return response.text();
    }
    
    async refreshToken() {
        if (this._refreshPromise) return this._refreshPromise;

        const refreshPromise = typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request('dmb-refresh', () => this._performRefresh()) : this._performRefresh();
        this._refreshPromise = refreshPromise;
        try {
            return await refreshPromise;
        } finally {
            if (this._refreshPromise === refreshPromise) this._refreshPromise = null;
        }
    }

    async _performRefresh(retried = false) {
        try {
            const response = await fetch(`${this.baseURL}/auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin'
            });
            
            if (response.status === 429 || response.status >= 500) throw new APIError('Сервис входа временно недоступен', response.status);
            if (response.status === 409 && !retried) return this._performRefresh(true);
            if (response.ok) {
                const data = await response.json();
                this.setAccessToken(data.access_token);
                this.rememberSession(data);
                this.refreshChannel?.postMessage({type: 'rotated'});
                return data;
            }
            return false;
        } catch (e) {
            throw e instanceof APIError ? e : new APIError('Сервис входа недоступен', 503);
        }
    }
    
    /**
     * @param {string} path
     * @returns {Promise<*>}
     */
    async get(path, requestOptions = {}) { return this.request('GET', path, null, requestOptions); }
    /**
     * @param {string} path
     * @param {*} data
     * @returns {Promise<*>}
     */
    async post(path, data, requestOptions = {}) { return this.request('POST', path, data, requestOptions); }
    /**
     * @param {string} path
     * @param {*} data
     * @returns {Promise<*>}
     */
    async put(path, data) { return this.request('PUT', path, data); }
    /**
     * @param {string} path
     * @returns {Promise<*>}
     */
    async delete(path) { return this.request('DELETE', path); }
    /**
     * @param {string} path
     * @param {*} data
     * @returns {Promise<*>}
     */
    async patch(path, data, requestOptions = {}) { return this.request('PATCH', path, data, requestOptions); }

    /**
     * Consume an authenticated Server-Sent Events response from a POST request.
     * The promise resolves with the payload of the final `result` event.
     */
    async stream(path, data, { signal, onEvent } = {}) {
        const url = `${this.baseURL}${path}`;
        const request = () => fetch(url, {
            method: 'POST',
            headers: { ...this.getHeaders(), Accept: 'text/event-stream' },
            credentials: 'same-origin',
            signal,
            body: JSON.stringify(data),
        });
        let response = await request();
        if (response.status === 401) {
            const refreshed = await this.refreshToken();
            if (refreshed) response = await request();
            else {
                this.setAccessToken(null);
                localStorage.removeItem('dmb_tokens');
                localStorage.removeItem('dmb_user');
                window.location.reload();
                throw new APIError('Authentication expired', 401);
            }
        }
        if (!response.ok) return this.handleResponse(response);
        if (!response.body) throw new APIError('Поток ответа недоступен', 502, 'stream_unavailable');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let result = null;
        const consume = async block => {
            const message = parseServerSentEvent(block);
            if (!message) return;
            if (message.event === 'error') {
                throw new APIError(
                    message.data?.message || 'Поток ответа прерван',
                    502,
                    message.data?.code || 'stream_failed',
                    message.data,
                );
            }
            if (message.event === 'result') result = message.data;
            await onEvent?.(message);
        };

        while (true) {
            const { value, done } = await reader.read();
            buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
            const blocks = buffer.split(/\r?\n\r?\n/);
            buffer = blocks.pop() || '';
            for (const block of blocks) await consume(block);
            if (done) break;
        }
        if (buffer.trim()) await consume(buffer);
        if (!result) throw new APIError('Ассистент не завершил поток ответа', 502, 'stream_incomplete');
        return result;
    }

    /**
     * Download an authenticated file without exposing a public storage URL.
     * @param {string} path
     * @param {string} filename
     */
    async download(path, filename) {
        const url = `${this.baseURL}${path}`;
        let response = await fetch(url, { headers: this.getHeaders() });

        if (response.status === 401 && await this.refreshToken()) {
            response = await fetch(url, { headers: this.getHeaders() });
        }
        if (!response.ok) return this.handleResponse(response);

        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        try {
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = filename || 'attachment';
            document.body.appendChild(link);
            link.click();
            link.remove();
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    }

    /**
     * Upload file via FormData
     * @param {string} path
     * @param {File} file
     * @returns {Promise<*>}
     */
    async upload(path, file, fields = {}) {
        const url = `${this.baseURL}${path}`;
        const formData = new FormData();
        formData.append('file', file);
        Object.entries(fields || {}).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') formData.append(key, String(value));
        });

        const headers = this.getHeaders();
        delete headers['Content-Type'];

        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: formData,
            credentials: 'same-origin'
        });

        if (response.status === 401) {
            const refreshed = await this.refreshToken();
            if (refreshed) {
                const retryHeaders = this.getHeaders();
                delete retryHeaders['Content-Type'];
                const retryResponse = await fetch(url, { method: 'POST', headers: retryHeaders, body: formData, credentials: 'same-origin' });
                return this.handleResponse(retryResponse);
            } else {
                this.setAccessToken(null);
                localStorage.removeItem('dmb_tokens');
                localStorage.removeItem('dmb_user');
                window.location.reload();
                throw new APIError('Authentication expired', 401);
            }
        }

        return this.handleResponse(response);
    }
}
