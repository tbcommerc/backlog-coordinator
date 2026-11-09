import {defineConfig} from '@playwright/test';
import base from './playwright.segmented.config.mjs';
export default defineConfig({...base,testMatch:['**/uiKitSettings.spec.mjs','**/uiKitExpress.spec.mjs','**/metricsQuarterly.spec.mjs','**/workVisualReview.spec.mjs','**/unifiedBacklogCompact.spec.mjs'],outputDir:'../.runtime/segmented-a-consumers'});
