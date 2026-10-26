export function announce(message, tone = 'polite') {
  const region = document.getElementById('assistant-v2-live');
  if (!region) return;
  region.setAttribute('aria-live', tone);
  region.textContent = '';
  requestAnimationFrame(() => { region.textContent = message; });
}

export function installUnsavedGuard(app, isDirty) {
  app.assistantV2NavigationGuard = async toPath => {
    if (toPath.startsWith('/assistant-v2') || !isDirty()) return true;
    if (typeof window.confirmAction === 'function') {
      return window.confirmAction('Есть несохранённые изменения Assistant V2. Покинуть страницу?');
    }
    return window.confirm('Есть несохранённые изменения Assistant V2. Покинуть страницу?');
  };
}

export function clearUnsavedGuard(app) {
  app.assistantV2NavigationGuard = null;
}

