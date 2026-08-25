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

export class API {
    constructor() {
        this.baseURL = '/api/v1';
        this.accessToken = null;
    }

    setAccessToken(token) { this.accessToken = token || null; }
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
        
        if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
            if (data instanceof FormData) {
                delete options.headers['Content-Type'];
                options.body = data;
            } else {
                options.body = JSON.stringify(data);
            }
        }
        
        const response = await fetch(url, options);
        
        if (response.status === 401) {
            const refreshed = await this.refreshToken();
            if (refreshed) {
                options.headers = this.getHeaders();
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
            throw new APIError(
                errorData.detail || `HTTP ${response.status}`,
                response.status,
                errorData.code || null,
                errorData,
                rawText
            );
        }
        
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            return response.json();
        }
        return response.text();
    }
    
    async refreshToken() {
        try {
            const response = await fetch(`${this.baseURL}/auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin'
            });
            
            if (response.ok) {
                const data = await response.json();
                this.setAccessToken(data.access_token);
                return data;
            }
            return false;
        } catch (e) {
            return false;
        }
    }
    
    /**
     * @param {string} path
     * @returns {Promise<*>}
     */
    async get(path) { return this.request('GET', path); }
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
    async upload(path, file) {
        const url = `${this.baseURL}${path}`;
        const formData = new FormData();
        formData.append('file', file);

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
