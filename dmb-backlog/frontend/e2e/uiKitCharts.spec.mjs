import { test, expect } from '@playwright/test';

test('canvas charts follow theme without losing data, filters or tooltip formatters', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/e2e/fixtures/uiKitAdminReports.html?surface=analytics&type=tribe');
  await expect.poll(() => page.evaluate(() => {
    const element = document.getElementById('dep-chart');
    return Boolean(element && window.echarts?.getInstanceByDom(element));
  })).toBe(true);
  await page.locator('#dep-mode').selectOption('undirected');
  const before = await page.evaluate(() => {
    const chart = window.echarts.getInstanceByDom(document.getElementById('dep-chart'));
    window.__chart = chart;
    return { nodes: chart.getOption().series[0].data.map(node => node.name), calls: window.__apiCalls.length };
  });
  for (const theme of ['dark', 'light']) {
    await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
    await expect.poll(() => page.evaluate(() => {
      const chart = window.__chart, option = chart.getOption(), root = getComputedStyle(document.documentElement);
      return option.textStyle.color === root.getPropertyValue('--text-secondary').trim()
        && option.series[0].data.every(node => node.label.color === option.textStyle.color)
        && option.tooltip[0].backgroundColor === root.getPropertyValue('--bg-secondary').trim();
    })).toBe(true);
    const after = await page.evaluate(() => {
      const chart = window.echarts.getInstanceByDom(document.getElementById('dep-chart'));
      return { same: chart === window.__chart, nodes: chart.getOption().series[0].data.map(node => node.name), formatter: typeof chart.getOption().tooltip[0].formatter, calls: window.__apiCalls.length, writes: window.__blockedWrites };
    });
    expect(after).toEqual({ same: true, nodes: before.nodes, formatter: 'function', calls: before.calls, writes: [] });
    await expect(page.locator('#dep-mode')).toHaveValue('undirected');
  }
  expect(errors).toEqual([]);
});
