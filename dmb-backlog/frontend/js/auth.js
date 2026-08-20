/**
 * DMB Backlog - Authentication Module
 */

/**
 * @typedef {Object} User
 * @property {number} id
 * @property {string} name
 * @property {string} email
 * @property {string} [role]
 * @property {string} [team]
 */

/**
 * @typedef {Object} LoginResponse
 * @property {string} access_token
 * @property {string} token_type
 * @property {number} expires_in
 * @property {User} user
 */

export class Auth {
    /**
     * @param {import('./api.js').API} api
     * @param {import('./store.js').Store} store
     */
    constructor(api, store) {
        this.api = api;
        this.store = store;
        localStorage.removeItem('dmb_tokens');
    }
    
    /**
     * @returns {boolean}
     */
    isAuthenticated() {
        return this.api.hasAccessToken();
    }
    
    /**
     * @param {string} email
     * @param {string} password
     * @returns {Promise<LoginResponse>}
     */
    async login(email, password) {
        const response = await this.api.post('/auth/login', { email, password });
        
        this.api.setAccessToken(response.access_token);
        localStorage.setItem('dmb_user', JSON.stringify(response.user));
        
        return response;
    }
    
    async logout() {
        try {
            await this.api.post('/auth/logout');
        } catch {
            // Local logout must still complete if the session is already expired.
        } finally {
            this.api.setAccessToken(null);
            localStorage.removeItem('dmb_user');
        }
    }

    async restoreSession() {
        const response = await this.api.refreshToken();
        if (!response) return false;
        localStorage.setItem('dmb_user', JSON.stringify(response.user));
        return true;
    }
    
    /**
     * @returns {User|null}
     */
    getCurrentUser() {
        return JSON.parse(localStorage.getItem('dmb_user') || 'null');
    }
}
