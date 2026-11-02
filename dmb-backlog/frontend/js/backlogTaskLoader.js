// Keep connections available for navigation and release them as soon as the user leaves.
export async function loadBacklogTaskPages(app, extraQuery = '', routePath) {
  const controller = new AbortController();
  const path = () => window.location.hash.slice(1).split('?')[0];
  const onNavigate = () => { if (path() !== routePath) controller.abort(); };
  window.addEventListener('hashchange', onNavigate);
  const getPage = async page => {
    controller.signal.throwIfAborted();
    const result = await app.api.get(`/tasks/?page=${page}&per_page=1000${extraQuery ? `&${extraQuery}` : ''}`, { signal: controller.signal });
    controller.signal.throwIfAborted();
    return result;
  };
  try {
    onNavigate();
    const first = await getPage(1);
    const pages = Math.max(1, Number(first.pages) || 1);
    if (pages === 1) return first;
    const parts = [first];
    let nextPage = 2;
    await Promise.all(Array.from({ length: Math.min(2, pages - 1) }, async () => {
      while (nextPage <= pages) {
        const page = nextPage++;
        parts[page - 1] = await getPage(page);
      }
    }));
    const items = parts.flatMap(part => part.items || []);
    return { ...first, items, total: Number(first.total) || items.length, page: 1, per_page: items.length, pages: 1 };
  } finally {
    controller.abort();
    window.removeEventListener('hashchange', onNavigate);
  }
}
