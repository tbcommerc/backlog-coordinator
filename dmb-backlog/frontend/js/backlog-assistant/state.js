const states = new Map();
export const terminal = status => !['queued', 'running', 'cancelling'].includes(status);
export function stateFor(userId) {
    if (!states.has(userId)) states.set(userId, { session: null, draft: '', pending: null, run: null, context: null });
    return states.get(userId);
}
export function contextFromLocation(hash = location.hash) {
    const [path, query = ''] = hash.replace(/^#/, '').split('?');
    const task = new URLSearchParams(query).get('task') || path.match(/^\/customer\/task\/(\d+)$/)?.[1];
    const request = path.match(/^\/customer\/request\/(\d+)$/)?.[1];
    return { surface: task ? 'task' : request ? 'request' : path.includes('report') ? 'report' : 'backlog',
        object_ref: task && /^\d+$/.test(task) ? `task:${task}` : request ? `request:${request}` : null,
        filters: { object_type: request ? 'request' : 'task' }, timezone: 'Europe/Moscow' };
}
