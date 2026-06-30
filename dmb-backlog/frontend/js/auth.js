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
 * @property {string} refresh_token
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
    }
    
    /**
     * @returns {boolean}
     */
    isAuthenticated() {
        const tokens = JSON.parse(localStorage.getItem('dmb_tokens') || '{}');
        return !!tokens.access;
    }
    
    /**
     * @param {string} email
     * @param {string} password
     * @returns {Promise<LoginResponse>}
     */
    async login(email, password) {
        const response = await this.api.post('/auth/login', { email, password });
        
        localStorage.setItem('dmb_tokens', JSON.stringify({
            access: response.access_token,
            refresh: response.refresh_token
        }));
        localStorage.setItem('dmb_user', JSON.stringify(response.user));
        
        return response;
    }
    
    logout() {
        localStorage.removeItem('dmb_tokens');
        localStorage.removeItem('dmb_user');
        window.location.reload();
    }
    
    /**
     * @returns {User|null}
     */
    getCurrentUser() {
        return JSON.parse(localStorage.getItem('dmb_user') || 'null');
    }
}