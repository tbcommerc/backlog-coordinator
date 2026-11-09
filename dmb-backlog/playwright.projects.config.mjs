import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./frontend/e2e',
 testMatch:['projectVisualAcceptance.spec.mjs','projectDesignReview.spec.mjs','projectManagement.spec.mjs','projectWorkspace.spec.mjs','projects.spec.mjs','workPagesUx.spec.mjs'],
 outputDir:'./playwright-report/project-review-results',
 timeout:45_000,expect:{timeout:10_000},fullyParallel:true,workers:2,reporter:'list',
 use:{baseURL:'http://127.0.0.1:4186',browserName:'chromium',trace:'retain-on-failure'},
 webServer:{command:'node frontend/e2e/staticServer.mjs',env:{PORT:'4186'},url:'http://127.0.0.1:4186',reuseExistingServer:false},
});
