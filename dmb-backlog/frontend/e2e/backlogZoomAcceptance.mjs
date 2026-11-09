// Real Chromium tab zoom, in a temporary isolated browser. No CSS/device emulation.
import{chromium,expect}from '@playwright/test';import{mkdir,writeFile}from 'node:fs/promises';import{fileURLToPath}from 'node:url';import{mockApp}from './helpers/backlogMock.mjs';
const extension=new URL('../../../.runtime/backlog-zoom-extension/',import.meta.url);await mkdir(extension,{recursive:true});await writeFile(new URL('manifest.json',extension),JSON.stringify({manifest_version:3,name:'Backlog isolated QA zoom',version:'1.0',permissions:['tabs'],background:{service_worker:'background.js'}}));await writeFile(new URL('background.js',extension),'chrome.runtime.onInstalled.addListener(()=>{});');
const path=fileURLToPath(extension);let context;const results=[];
try{
 context=await chromium.launchPersistentContext('',{channel:'chromium',headless:true,viewport:{width:1440,height:900},args:[`--disable-extensions-except=${path}`,`--load-extension=${path}`]});
 let worker=context.serviceWorkers()[0];if(!worker)worker=await context.waitForEvent('serviceworker');const page=context.pages()[0]||await context.newPage();await mockApp(page);
 for(const scope of ['all','team']){
  await page.goto('http://127.0.0.1:8000/#/backlog?scope='+scope,{waitUntil:'domcontentloaded'});await page.locator('#tasks-content[data-ready="true"]').waitFor();
  const before=await page.evaluate(()=>({dpr:devicePixelRatio,width:innerWidth}));
  const zoom=await worker.evaluate(async()=>{const tabs=await chrome.tabs.query({url:'http://127.0.0.1:8000/*'});if(tabs.length!==1)throw Error('Ambiguous isolated QA tab');await chrome.tabs.setZoom(tabs[0].id,2);return chrome.tabs.getZoom(tabs[0].id);});
  await expect.poll(()=>page.evaluate(()=>devicePixelRatio)).toBeCloseTo(before.dpr*2,1);
  const after=await page.evaluate(()=>({dpr:devicePixelRatio,width:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth,search:document.getElementById('f-backlog-search').getBoundingClientRect().width}));
  expect(zoom).toBe(2);expect(after.overflow).toBeLessThanOrEqual(1);expect(after.search).toBeGreaterThan(90);await expect(page.locator('#tasks-table')).toBeVisible();await expect(page.locator('[data-backlog-scope="'+scope+'"]').first()).toBeVisible();
  await page.screenshot({path:fileURLToPath(new URL('../../../.runtime/evidence/backlog-unification/'+scope+'-zoom200.png',import.meta.url)),fullPage:true});results.push({scope,status:'PASS',method:'chrome.tabs.setZoom; getZoom=2',before,after});
  await worker.evaluate(async()=>{const[t]=await chrome.tabs.query({url:'http://127.0.0.1:8000/*'});await chrome.tabs.setZoom(t.id,1);});
 }
}catch(error){results.push({status:'FAIL',error:String(error.message).slice(0,700)});process.exitCode=1;}
finally{await context?.close();await writeFile(new URL('../../../.runtime/backlog-unification-zoom.json',import.meta.url),JSON.stringify(results,null,2));console.log(JSON.stringify(results));}
