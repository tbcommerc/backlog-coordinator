/**
 * DMB Backlog - Simple State Store
 * Pub/Sub pattern for state management
 */

export class Store {
    constructor() {
        /** @type {Record<string, *>} */
        this.state = {};
        /** @type {Record<string, Array<function(*)>>} */
        this.listeners = {};
    }
    
    /**
     * @param {string} key
     * @returns {*}
     */
    get(key) {
        return this.state[key];
    }
    
    /**
     * @param {string} key
     * @param {*} value
     */
    set(key, value) {
        this.state[key] = value;
        this.notify(key, value);
    }
    
    /**
     * @param {string} key
     * @param {function(*)} updater
     */
    update(key, updater) {
        const currentValue = this.state[key];
        const newValue = updater(currentValue);
        this.set(key, newValue);
    }
    
    /**
     * @param {string} key
     * @param {function(*)} callback
     * @returns {function(): void} unsubscribe function
     */
    subscribe(key, callback) {
        if (!this.listeners[key]) {
            this.listeners[key] = [];
        }
        this.listeners[key].push(callback);
        
        return () => {
            this.listeners[key] = this.listeners[key].filter(cb => cb !== callback);
        };
    }
    
    /**
     * @param {string} key
     * @param {*} value
     */
    notify(key, value) {
        if (this.listeners[key]) {
            this.listeners[key].forEach(callback => callback(value));
        }
    }
}