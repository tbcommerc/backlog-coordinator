import {defineConfig} from '@playwright/test';
import base from './playwright.config.mjs';
export default defineConfig({...base,timeout:60000,expect:{timeout:15000},workers:2,
 testMatch:/(?:aiActions|workToolbar|workTaskDrawer|workSplitWorkspace|workListDensity|workQueueAlignment|metricsQuarterly|metricsSimplification|uiKitMetricsIntegration|metricsToolbar|unifiedBacklogVisual|unifiedBacklogCardFlows)\.spec\.mjs$/,
 outputDir:'../.runtime/ui-regression',reporter:[['line'],['json',{outputFile:'../.runtime/backlog-six-browser-results.json'}]],
 use:{...base.use,baseURL:'http://127.0.0.1:4196'},
 webServer:{...base.webServer,env:{PORT:'4196'},url:'http://127.0.0.1:4196',reuseExistingServer:false}});
