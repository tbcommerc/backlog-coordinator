import base from './playwright.config.mjs';
export default {...base,testMatch:'taskCardReferenceIntegrity.spec.mjs',workers:1,timeout:45000,
  outputDir:'../.test-field-links/fixed-browser',use:{...base.use,trace:'off',viewport:{width:1440,height:1000}}};
