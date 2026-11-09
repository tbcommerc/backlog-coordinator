import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./frontend/e2e',testMatch:'neutralLinks.spec.mjs',outputDir:'.runtime/neutral-links-tests',workers:2,timeout:60000,use:{baseURL:'http://127.0.0.1:4193',browserName:'chromium'},webServer:{command:'node frontend/e2e/staticServer.mjs',env:{PORT:'4193'},url:'http://127.0.0.1:4193',reuseExistingServer:true}});
