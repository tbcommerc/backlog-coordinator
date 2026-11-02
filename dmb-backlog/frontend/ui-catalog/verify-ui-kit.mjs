// A receipt is written only after all suites pass against an unchanged tree.
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {buildInventory} from './build-family-inventory.mjs';
const cwd=fileURLToPath(new URL('../../',import.meta.url));
const receipt=new URL('./verification-receipt.json',import.meta.url);
function digest(){
 const inventory=buildInventory();
 const base=new URL('../../',import.meta.url);
 const walk=p=>!existsSync(new URL(p,base))?[]:readdirSync(new URL(p,base),{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(p+'/'+e.name):[p+'/'+e.name]);
 const checks=[...readdirSync(new URL('frontend/',base)).filter(n=>n.endsWith('.html')).map(n=>'frontend/'+n),'docs/UI_KIT.md','docs/UI_KIT_CONTRACTS.md','docs/UI_KIT_MIGRATION_MATRIX.md','package.json','package-lock.json','playwright.config.mjs',...['frontend/tests','frontend/e2e','frontend/ui-catalog','frontend/fonts'].flatMap(walk)].filter(p=>!/(?:family-inventory|verification-receipt)\.json$/.test(p)&&existsSync(new URL(p,base)));
 const hash=createHash('sha256').update(JSON.stringify(inventory));
 for(const p of checks.sort())hash.update(p+'\0').update(createHash('sha256').update(readFileSync(new URL(p,base))).digest());
 return hash.digest('hex');
}
if(process.argv.includes('--check')){
 if(!existsSync(receipt))throw Error('No current UI Kit receipt: run npm run verify:ui-kit and resolve all failures');
 const saved=JSON.parse(readFileSync(receipt,'utf8'));
 if(saved.sha256!==digest())throw Error('UI Kit evidence is stale: rerun npm run verify:ui-kit');
 console.log('UI Kit receipt matches source, contracts and tests.');
}else{
 const before=digest();
 const suites=readdirSync(new URL('../e2e/',import.meta.url)).filter(n=>n.endsWith('.spec.mjs')).map(n=>n.replace('.spec.mjs','')).sort();
 const commands=[['--test',...readdirSync(new URL('../tests/',import.meta.url)).filter(n=>n.endsWith('.test.mjs')).map(n=>'frontend/tests/'+n)],['node_modules/@playwright/test/cli.js','test',...suites.map(n=>'frontend/e2e/'+n+'.spec.mjs'),'--workers=2','--reporter=line']];
 for(const args of commands){const run=spawnSync(process.execPath,args,{cwd,stdio:'inherit'});if(run.status!==0)process.exit(run.status||1);}
 if(before!==digest())throw Error('Sources changed during verification; no receipt created');
 writeFileSync(new URL('./family-inventory.json',import.meta.url),JSON.stringify(buildInventory(),null,2)+'\n');
 writeFileSync(receipt,JSON.stringify({schema:1,verifiedAt:new Date().toISOString(),sha256:before,suites,scope:'UI contracts and isolated real consumers; live checks are documented separately.'},null,2)+'\n');
}
