// Context actions live in the page toolbar, separate from navigation.
export function supportsContextHelp(hash) {
    const path = hash.replace(/^#/, '').split('?')[0];
    return /^\/(?:backlog|team-backlog|reports)(?:\/|$)/.test(path)
        || /^\/customer\/(?:task|request)\/\d+$/.test(path);
}
export async function initContextHelp(button, app) {
    if (!button) return;
    let enabled = false;
    const update = () => { button.hidden = !enabled || !supportsContextHelp(location.hash); };
    const onHash = () => {
        if (!button.isConnected) { window.removeEventListener('hashchange', onHash); return; }
        update();
    };
    window.addEventListener('hashchange', onHash);
    button.addEventListener('click', async () => {
        const { openPanel } = await import('./panel.js');
        openPanel(app);
    });
    try { enabled = (await app.api.get('/backlog-assistant/capabilities')).enabled === true; } catch { /* stays hidden */ }
    update();
}
