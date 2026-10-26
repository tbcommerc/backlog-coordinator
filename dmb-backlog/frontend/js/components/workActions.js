// All surfaces issue the same versioned command. The server owns transition policy.
export const transitionWork = (app, row, status, input = {}) => {
    if(typeof navigator!=='undefined'&&!navigator.onLine)return Promise.reject(new Error('Нет связи. Повторите действие после восстановления сети.'));
    return app.api.post(`/work-tasks/${row.id}/transitions`, {version:row.version,status,...input});
};
