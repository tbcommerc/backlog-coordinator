import config from './playwright.config.mjs';
export default {
  ...config, workers:1, fullyParallel:false,
  testMatch:/\/(?:uiTypographyAcceptance|uiKitTypography|uiKitDialogAcceptance|requirementWorkspace|uiKitComplexFormsReview|uiKitConsistency|uiKitExpress|uiKitCharts)\.spec\.mjs$/,
  outputDir:'../.runtime/typography-retest-2026-10-19',
  reporter:[['line'],['json',{outputFile:'../.runtime/typography-retest-2026-10-19/results.json'}]],
  // Context-heavy dialog loops can corrupt trace archives on this Windows host.
  // Keep strict assertions and screenshots; a trace failure must not mask UI QA.
  use:{...config.use,trace:'off',screenshot:'only-on-failure'},
  projects:[
    {name:'chrome',use:{browserName:'chromium',channel:'chrome'}},
    {name:'edge',use:{browserName:'chromium',channel:'msedge'}},
    {name:'firefox',use:{browserName:'firefox',channel:undefined}},
    {name:'webkit',use:{browserName:'webkit',channel:undefined}},
  ],
};
