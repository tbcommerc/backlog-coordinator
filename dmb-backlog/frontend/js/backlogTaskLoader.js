// A complete, cancellable snapshot; no partial result is presented as a register.
export async function loadBacklogTaskPages(app, extraQuery='',routePath,{signal,contextKey}={}) {
 const controller=new AbortController(); const initial=contextKey?.();
 const validate=()=>{if(signal?.aborted)controller.abort(signal.reason);if(contextKey&&contextKey()!==initial)controller.abort();controller.signal.throwIfAborted();};
 const onAbort=()=>controller.abort(signal.reason);
 const onNavigate=()=>{if(window.location.hash.slice(1).split('?')[0]!==routePath||(contextKey&&contextKey()!==initial))controller.abort();};
 signal?.addEventListener('abort',onAbort,{once:true});window.addEventListener('hashchange',onNavigate);
 const getPage=async page=>{validate();const result=await app.api.get(`/tasks/?page=${page}&per_page=1000${extraQuery?'&'+extraQuery:''}`,{signal:controller.signal});validate();return result;};
 const snapshot=async()=>{
  const first=await getPage(1);const pages=Math.max(1,Number(first.pages)||1);const parts=[first];let nextPage=2;
  await Promise.all(Array.from({length:Math.min(2,pages-1)},async()=>{while(nextPage<=pages){const page=nextPage++;parts[page-1]=await getPage(page);}}));
  const seen=new Set();const items=parts.flatMap(p=>p.items||[]).filter(item=>{const key=item&&typeof item==='object'?item.id:item;if(seen.has(key))return false;seen.add(key);return true;});
  return {...first,items,total:Number.isFinite(Number(first.total))?Number(first.total):items.length,page:1,per_page:items.length,pages:1};
 };
 try{onNavigate();validate();let result=await snapshot();if(result.items.length!==result.total){result=await snapshot();if(result.items.length!==result.total){const error=new Error('Выборка изменилась во время загрузки. Повторите обновление.');error.name='BacklogSnapshotError';throw error;}}return result;}
 finally{controller.abort();window.removeEventListener('hashchange',onNavigate);signal?.removeEventListener('abort',onAbort);}
}
