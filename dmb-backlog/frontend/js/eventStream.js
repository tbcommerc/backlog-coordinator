let activeController = null;
let reconnectTimer = null;
let reconnectDelay = 1000;
let activeApp = null;

function cursorKey(app) {
  const userId = app?.store?.get('currentUser')?.id || 'anonymous';
  return `dmb:event-stream-cursor:${userId}`;
}

function parseEventBlock(block) {
  let id = '', event = 'message';
  const data = [];
  block.split(/\r?\n/).forEach(line => {
    if (line.startsWith('id:')) id = line.slice(3).trim();
    else if (line.startsWith('event:')) event = line.slice(6).trim() || 'message';
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  });
  if (!data.length) return null;
  try { return { id, event, data: JSON.parse(data.join('\n')) }; }
  catch { return null; }
}

function dispatchEventMessage(app, message) {
  if (message.id) {
    try { sessionStorage.setItem(cursorKey(app), message.id); } catch (_) { /* no-op */ }
  }
  const detail = message.data || {};
  if (String(message.event).startsWith('notification.')) {
    document.dispatchEvent(new CustomEvent('dmb:notification-changed', { detail }));
  }
  if (String(message.event).startsWith('task.')) {
    document.dispatchEvent(new CustomEvent('dmb:task-changed', { detail }));
    if (message.event === 'task.collection.changed') {
      window.toast?.('Состав доступных задач изменился. Обновите текущий список.', 'info');
    }
  }
  if (String(message.event).startsWith('requirement.')) {
    document.dispatchEvent(new CustomEvent('dmb:requirement-changed', { detail }));
  }
  if (String(message.event).startsWith('report.')) {
    document.dispatchEvent(new CustomEvent('dmb:report-changed', { detail }));
  }
}

async function connect(app) {
  if (document.hidden || activeController || !app?.api?.hasAccessToken?.()) return;
  const controller = new AbortController();
  activeController = controller;
  let cursor = '';
  try { cursor = sessionStorage.getItem(cursorKey(app)) || ''; } catch (_) { /* no-op */ }
  const suffix = cursor ? `?after=${encodeURIComponent(cursor)}` : '';
  try {
    let response = await fetch(`/api/v1/events/stream${suffix}`, {
      headers: { ...app.api.getHeaders(), Accept: 'text/event-stream' },
      credentials: 'same-origin',
      signal: controller.signal,
    });
    if (response.status === 401 && await app.api.refreshToken()) {
      response = await fetch(`/api/v1/events/stream${suffix}`, {
        headers: { ...app.api.getHeaders(), Accept: 'text/event-stream' },
        credentials: 'same-origin',
        signal: controller.signal,
      });
    }
    if (!response.ok || !response.body) throw new Error(`SSE HTTP ${response.status}`);

    reconnectDelay = 1000;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || '';
      blocks.forEach(block => {
        const message = parseEventBlock(block);
        if (message) dispatchEventMessage(app, message);
      });
    }
  } catch (error) {
    if (error?.name !== 'AbortError') {
      document.dispatchEvent(new CustomEvent('dmb:event-stream-status', { detail: { connected: false } }));
    }
  } finally {
    if (activeController === controller) activeController = null;
    if (!document.hidden && activeApp === app) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = window.setTimeout(() => connect(app), reconnectDelay);
      reconnectDelay = Math.min(30000, reconnectDelay * 2);
    }
  }
}

export function startEventStream(app) {
  stopEventStream();
  activeApp = app;
  connect(app);
}

export function pauseEventStream() {
  activeController?.abort();
  activeController = null;
  window.clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

export function resumeEventStream() {
  if (activeApp) connect(activeApp);
}

export function stopEventStream() {
  pauseEventStream();
  activeApp = null;
  reconnectDelay = 1000;
}

export { parseEventBlock };
