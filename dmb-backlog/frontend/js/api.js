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
    }
    
    /**
     * @returns {Record<string, string>}
     */
    getHeaders() {
        const headers = {
            'Content-Type': 'application/json'
        };
        
        const tokens = JSON.parse(localStorage.getItem('dmb_tokens') || '{}');
        if (tokens.access) {
            headers['Authorization'] = `Bearer ${tokens.access}`;
        }
        
        return headers;
    }
    
    /**
     * @param {string} method
     * @param {string} path
     * @param {*} [data]
     * @returns {Promise<*>}
     */
    async request(method, path, data = null) {
        const url = `${this.baseURL}${path}`;
        const options = {
            method,
            headers: this.getHeaders()
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
        const tokens = JSON.parse(localStorage.getItem('dmb_tokens') || '{}');
        if (!tokens.refresh) return false;
        
        try {
            const response = await fetch(`${this.baseURL}/auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: tokens.refresh })
            });
            
            if (response.ok) {
                const data = await response.json();
                localStorage.setItem('dmb_tokens', JSON.stringify({
                    access: data.access_token,
                    refresh: data.refresh_token
                }));
                return true;
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
    async post(path, data) { return this.request('POST', path, data); }
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
    async patch(path, data) { return this.request('PATCH', path, data); }

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

        const tokens = JSON.parse(localStorage.getItem('dmb_tokens') || '{}');
        const headers = {};
        if (tokens.access) {
            headers['Authorization'] = `Bearer ${tokens.access}`;
        }

        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: formData
        });

        if (response.status === 401) {
            const refreshed = await this.refreshToken();
            if (refreshed) {
                const retryHeaders = {};
                const newTokens = JSON.parse(localStorage.getItem('dmb_tokens') || '{}');
                if (newTokens.access) retryHeaders['Authorization'] = `Bearer ${newTokens.access}`;
                const retryResponse = await fetch(url, { method: 'POST', headers: retryHeaders, body: formData });
                return this.handleResponse(retryResponse);
            } else {
                localStorage.removeItem('dmb_tokens');
                localStorage.removeItem('dmb_user');
                window.location.reload();
                throw new APIError('Authentication expired', 401);
            }
        }

        return this.handleResponse(response);
    }
}