import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {families} from './family-contracts.mjs';
const root=new URL('../',import.meta.url),read=p=>readFileSync(new URL(p,root),'utf8');
function walk(p){return readdirSync(new URL(p,root),{withFileTypes:true}).flatMap(e=>e.isDirectory()?['lib'].includes(e.name)?[]:walk(p+'/'+e.name):[p+'/'+e.name]);}
export function buildInventory(){
 const paths=[...walk('js'),...walk('css'),...walk('e2e/fixtures')].filter(p=>/\.(js|css|html)$/.test(p)).sort();
 const sources=paths.map(path=>({path,sha256:createHash('sha256').update(read(path)).digest('hex')}));
 const consumers=families.map(f=>({...f,consumers:paths.filter(p=>p.startsWith('js/')&&!p.startsWith('js/ui/')&&f.exports.some(name=>new RegExp('\\b'+name+'\\b').test(read(p))))}));
 return {schema:1,method:'Static candidates by exported symbol; browser state evidence is separate. A hash mismatch invalidates the receipt.',surfaces:JSON.parse(read('ui-catalog/migration-matrix.json')).surfaces.length,families:consumers,sources};
}
if(process.argv[1]?.endsWith('build-family-inventory.mjs')){
 const body=JSON.stringify(buildInventory(),null,2)+'\n',url=new URL('ui-catalog/family-inventory.json',root);
 if(process.argv.includes('--check')){if(readFileSync(url,'utf8')!==body)throw Error('Family inventory is stale; regenerate and rerun acceptance');}
 else writeFileSync(url,body);
}
