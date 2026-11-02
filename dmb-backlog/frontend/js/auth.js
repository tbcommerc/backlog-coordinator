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

export function normalizeSessionUser(user) {
    return user ? { ...user, role_name: user.role_name || user.role || null } : user;
}

export class Auth {
    /**
     * @param {import('./api.js').API} api
     * @param {import('./store.js').Store} store
     */
    constructor(api, store) {
        this.api = api;
        this.store = store;
        this.channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('dmb-account-security') : null;
        if (this.channel) this.channel.onmessage = event => {
            if (event.data?.type === 'logout') {
                this.api.setAccessToken(null);
                localStorage.removeItem('dmb_user');
                window.location.reload();
            }
        };
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
    async login(login, password) {
        const operation = async context => {
            const response = await this.api.post('/auth/login', { login, password });
            if (context != null) this.api.assertAuthContext?.(context);
            response.user = normalizeSessionUser(response.user);
            this.api.setAccessToken(response.access_token);
            this.api.rememberSession(response);
            localStorage.setItem('dmb_user', JSON.stringify(response.user));
            return response;
        };
        return this.api.withAuthTransition ? this.api.withAuthTransition(operation) : operation();
    }

    async logout() {
        const operation = async context => {
            await this.api.post('/auth/logout');
            if (context != null) this.api.assertAuthContext?.(context);
            this.api.setAccessToken(null);
            localStorage.removeItem('dmb_user');
            this.store?.set('currentUser', null);
            this.channel?.postMessage({type:'logout'});
        };
        return this.api.withAuthTransition ? this.api.withAuthTransition(operation) : operation();
    }

    async restoreSession() {
        const response = await this.api.refreshToken();
        if (!response) return false;
        response.user = normalizeSessionUser(response.user);
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
