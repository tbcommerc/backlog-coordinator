import { test, expect } from '@playwright/test';
const audit='/e2e/fixtures/notificationAudit.html';
test('external read recalculates unread results and pagination',async({page})=>{
 await page.goto(audit+'#/notifications?view=unread');await expect(page.locator('#notification-results-count')).toHaveText('36 уведомлений');
 await page.locator('#audit-external-read').click();await expect(page.locator('[data-notif-id="2"]')).toHaveCount(0);await expect(page.locator('#notification-results-count')).toHaveText('35 уведомлений');
 await page.locator('#notifications-load-more').click();await expect(page.locator('.notification-card')).toHaveCount(35);
});
test('filter error clears metadata and retries current filter',async({page})=>{
 await page.goto(audit);await expect(page.locator('.notification-card')).toHaveCount(20);await page.locator('#audit-read-error').click();await page.locator('[data-filter-category="mention"]').click();
 await expect(page.locator('#notification-results-count')).toHaveText('Количество неизвестно');await expect(page.locator('#notifications-load-more')).toBeHidden();
 await page.locator('#audit-read-error').click();await page.locator('[data-view-state-action]').click();await expect(page.locator('#notification-results-count')).toHaveText('1 уведомление');
});
test('keyboard focus follows removed card',async({page})=>{
 await page.goto(audit+'#/notifications?view=unread');const read=page.locator('[data-notif-id="2"] [data-mark-read]');await read.focus();await read.press('Enter');
 await expect(page.locator('[data-notif-id="2"]')).toHaveCount(0);await expect(page.locator('[data-notif-id="3"] [data-mark-read]')).toBeFocused();
});
test('bulk describes actual changes and mandatory exclusions',async({page})=>{
 await page.goto(audit);await expect(page.locator('.notification-card')).toHaveCount(20);await page.locator('#mark-all-read').click();await expect(page.locator('#toast-container')).toContainText('Отмечено прочитанными: 35');
 await page.locator('#mark-all-read').click();await expect(page.locator('#toast-container')).toContainText('Нет уведомлений для отметки');await expect(page.locator('[data-notif-id="1"]')).toHaveClass(/is-unread/);
});
for(const width of [320,390,1280])test(`long content fits at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.goto(audit);await expect(page.locator('.notification-card')).toHaveCount(20);
 expect(await page.locator('.notification-card p,.notification-card-actions .btn-primary').evaluateAll(nodes=>nodes.filter(n=>n.scrollWidth>n.clientWidth+1).map(n=>n.textContent))).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
});
test('quarterly target keeps return context',async({page})=>{
 await page.goto(audit+'#/notifications?category=reporting&view=action');await page.locator('[data-open-notification]').click();await expect(page.locator('#audit-log')).toHaveText('Переход: /quarterly-goals-update?source=notification');
 expect(await page.evaluate(()=>sessionStorage.getItem('notifications:return-route'))).toBe('#/notifications?category=reporting&view=action');
});
test('outbox error is unknown and empty is not proof of delivery',async({page})=>{
 await page.goto(audit+'?surface=outbox');await expect(page.locator('#outbox-total-count')).toHaveText('1 событий');await page.locator('#audit-read-error').click();await page.locator('#outbox-refresh-btn').click();
 await expect(page.locator('#outbox-total-count')).toHaveText('Количество неизвестно');await expect(page.locator('.outbox-metric strong').first()).toHaveText('—');
 await page.locator('#audit-read-error').click();await page.locator('#audit-empty').click();await page.locator('#outbox-refresh-btn').click();await expect(page.locator('#outbox-dead-letter-body')).toContainText('могут ещё ожидать доставки');
});
test('explicit missing meeting never falls back',async({page})=>{
 await page.goto('/e2e/fixtures/uiKitReportingWorkspaces.html#/reporting-statuses?source=notification&meeting_id=999');await expect(page.getByText('Встреча недоступна',{exact:true})).toBeVisible();await expect(page.locator('[data-save-reporting-task]')).toHaveCount(0);
});
test('same quarterly fact can be confirmed',async({page})=>{
 await page.goto('/e2e/fixtures/uiKitReportingWorkspaces.html?surface=quarterly');await page.locator('[data-quarterly-confirm="1"]').click();expect(await page.evaluate(()=>window.__writes[0])).toMatchObject({body:{progress:25,confirm_progress:true,version:1}});
});
test('comment deep-link waits for data without false warning',async({page})=>{
 await page.goto('/e2e/fixtures/taskCardIncrement.html#/backlog?task=42&tab=com&comment=21');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');await expect(page.locator('#task-comment-21')).toHaveClass(/is-targeted/);await expect(page.getByText('Комментарий по ссылке не найден или больше недоступен',{exact:true})).toHaveCount(0);
});
test('successful comment clears active editor after redraw',async({page})=>{
 await page.goto('/e2e/fixtures/taskCardIncrement.html#/backlog?task=42&tab=com');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
 await page.evaluate(()=>{const post=window.app.api.post;window.app.api.post=async(path,body)=>{if(path.endsWith('/comments'))await new Promise(resolve=>window.__finishComment=resolve);return post(path,body);};});
 await page.locator('#comment-textarea').fill('Отправленный текст');await page.locator('#comment-submit-btn').click();await page.locator('#task-tab-main').click();await page.locator('#task-tab-com').click();await page.evaluate(()=>window.__finishComment());
 await expect(page.locator('#comment-textarea')).toHaveValue('');await expect(page.locator('#comment-submit-btn')).toBeDisabled();await expect(page.locator('#comment-draft-status')).toBeHidden();
});

test('return link survives reload with complete filter route',async({page})=>{
 await page.goto('/e2e/fixtures/uiKitReportingWorkspaces.html#/reporting-statuses?source=notification&meeting_id=61');
 await page.evaluate(()=>sessionStorage.setItem('notifications:return-route','#/notifications?view=unread&category=reporting&importance=high'));
 await page.reload();await expect(page.locator('.reporting-status-close')).toHaveAttribute('href','#/notifications?view=unread&category=reporting&importance=high');
});
test('reading final filtered card focuses feed heading',async({page})=>{
 await page.goto(audit+'#/notifications?view=unread&category=mention');await page.locator('[data-mark-read]').press('Enter');await expect(page.locator('.notification-card')).toHaveCount(0);await expect(page.locator('#notifications-heading')).toBeFocused();
});
test('new text typed while sending is preserved',async({page})=>{
 await page.goto('/e2e/fixtures/taskCardIncrement.html#/backlog?task=42&tab=com');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
 await page.evaluate(()=>{const post=window.app.api.post;window.app.api.post=async(path,body)=>{if(path.endsWith('/comments'))await new Promise(resolve=>window.__finishComment=resolve);return post(path,body);};});
 await page.locator('#comment-textarea').fill('Первый текст');await page.locator('#comment-submit-btn').click();await page.locator('#comment-textarea').fill('Следующий черновик');await page.evaluate(()=>window.__finishComment());await expect(page.locator('#comment-submit-btn')).toBeEnabled();await expect(page.locator('#comment-textarea')).toHaveValue('Следующий черновик');
});
