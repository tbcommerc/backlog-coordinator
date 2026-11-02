const response = await fetch('/static/index.html');
const doc = new DOMParser().parseFromString(await response.text(),'text/html');
await Promise.all([...doc.querySelectorAll('link[rel="stylesheet"]')].map(source => new Promise((resolve,reject) => { const link=source.cloneNode(); link.onload=resolve; link.onerror=()=>reject(new Error('Stylesheet: '+link.href)); document.head.append(link); })));
