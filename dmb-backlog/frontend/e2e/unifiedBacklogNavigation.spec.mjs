import { test, expect } from '@playwright/test';
import { mockApp } from './helpers/backlogMock.mjs';
test('BU-R01/R04/R05/D02: one workspace and legacy route',async({page})=>{
 await mockApp(page);await page.goto('/#/backlog');
 await expect(page.locator('#tasks-table tbody tr[data-task-id]')).toHaveCount(3);
 await expect(page.locator('.sidebar-item[aria-label="Бэклог"]')).toHaveCount(1);
 await page.locator('[data-backlog-scope="team"]').click();
 await expect(page.locator('#tasks-table tbody tr[data-task-id]')).toHaveCount(2);
 await expect(page.locator('.quick-filter-btn[data-filter="urgent"] .quick-filter-count')).toHaveText('1');
 await page.goto('/#/team-backlog');await expect(page.locator('#tasks-table tbody tr[data-task-id]')).toHaveCount(2);
 await expect(page).toHaveURL(/backlog\?bv=2&scope=team/);
});
test('BU-S01/F02: independent search',async({page})=>{
 await mockApp(page);await page.goto('/#/backlog');await expect(page.locator('#tasks-table')).toBeVisible();
 await page.locator('#f-backlog-search').fill('уникальное');await expect(page.locator('#tasks-count')).toHaveText('Найдено: 1 задача');
 await page.locator('[data-backlog-scope="team"]').click();await expect(page.locator('#f-backlog-search')).toHaveValue('');
 await page.locator('[data-backlog-scope="all"]').click();await expect(page.locator('#f-backlog-search')).toHaveValue('уникальное');
 await expect(page.locator('#tasks-count')).toHaveText('Найдено: 1 задача');
});
test('BU-A05/A08: read-only and malformed scope',async({page})=>{
 await mockApp(page,{readonly:true});await page.goto('/#/backlog?scope=team');await expect(page.locator('#backlog-inline-edit')).toBeDisabled();
 await page.goto('/#/backlog?scope=invalid');await expect(page.locator('#tasks-table')).toHaveCount(0);
 await expect(page.getByText(/Неизвестная область|Область недоступна/)).toBeVisible();
});
test('BU-C02: deep task link',async({page})=>{
 await mockApp(page);await page.goto('/#/backlog?bv=2&scope=team&task=41&tab=com');await expect(page.locator('#task-detail-overlay')).toBeVisible();await expect(page).toHaveURL(/scope=team/);
});

test('BU-R01/R03: sidebar keeps the last context and exact search after leaving the page',async({page})=>{await mockApp(page);await page.goto('/#/backlog?scope=all');await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready','true');await page.locator('[data-backlog-scope="team"]').click();await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready','true');await page.locator('#f-backlog-search').fill('Первая');await expect(page.locator('#tasks-table tr[data-task-id]')).toHaveCount(1);const menu=page.locator('.sidebar-item[aria-label="Бэклог"]');await expect(menu).toHaveAttribute('href',/bv=2&scope=team/);await page.locator('.sidebar-item[href="#/dashboard"]').click();await menu.click();await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready','true');await expect(page.locator('#f-backlog-search')).toHaveValue('Первая');await expect(page.locator('[data-backlog-scope="team"]')).toHaveAttribute('aria-pressed','true');});
