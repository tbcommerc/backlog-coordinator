import {defineConfig} from '@playwright/test';
import base from './playwright.config.mjs';
export default defineConfig({...base,testMatch:['**/segmentedControl.spec.mjs'],workers:1,outputDir:'../.runtime/segmented-a-controls',reporter:'line',use:{...base.use,baseURL:'http://127.0.0.1:4195'},webServer:{...base.webServer,env:{PORT:'4195'},url:'http://127.0.0.1:4195',reuseExistingServer:true}});
