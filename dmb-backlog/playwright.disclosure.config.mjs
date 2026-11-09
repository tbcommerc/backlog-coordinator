import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./frontend/e2e',testMatch:'disclosureNavigation.spec.mjs',outputDir:'.runtime/disclosure-tests',workers:1,timeout:60000,use:{baseURL:'http://127.0.0.1:4192',browserName:'chromium'},webServer:{command:'node frontend/e2e/staticServer.mjs',env:{PORT:'4192'},url:'http://127.0.0.1:4192',reuseExistingServer:true}});
