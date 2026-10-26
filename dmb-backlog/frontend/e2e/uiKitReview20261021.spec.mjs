import { test, expect } from '@playwright/test';

test('catalog exposes native choices, vertical tabs, alert tones and bounded popover widths', async ({ page }) => {
  await page.goto('/ui-catalog/index.html');
  await expect(page.locator('#alerts .ui-alert')).toHaveCount(5);
  await page.getByLabel('Компактная', { exact: true }).check();
  await expect(page.getByLabel('Компактная', { exact: true })).toBeChecked();
  await page.locator('#vertical-one-tab').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#vertical-two-tab')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#vertical-two-panel')).toBeVisible();
  for (const [width, pixels] of [['small', 256], ['default', 320], ['wide', 512]]) {
    await page.locator(`[data-width-demo="${width}"]`).click();
    const panel = page.locator(`#width-${width}`);
    await expect(panel).toBeVisible();
    expect((await panel.boundingBox()).width).toBe(pixels);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  }
  await page.setViewportSize({ width: 320, height: 568 });
  await page.locator('[data-width-demo="wide"]').click();
  expect((await page.locator('#width-wide').boundingBox()).width).toBeLessThanOrEqual(304);
});

test('popover stack, action menu and tooltip clean up listeners and restore ownership', async ({ page }) => {
  await page.goto('/ui-catalog/index.html');
  const result = await page.evaluate(async () => {
    const { bindPopover, bindActionMenu, bindTooltip, setButtonBusy } = await import('/js/ui/index.js');
    const host = document.createElement('div');
    host.innerHTML = '<button id="p-trigger">Parent</button><div id="p-panel"><button id="c-trigger">Child</button></div><div id="c-panel"><button disabled>Disabled</button><button>Action</button></div><button id="tip-trigger" aria-describedby="existing">Tip</button><div id="tip-panel">Description</div>';
    document.body.append(host);
    const get = id => document.getElementById(id);
    const parent = bindPopover({ trigger: get('p-trigger'), panel: get('p-panel') });
    const child = bindActionMenu({ trigger: get('c-trigger'), panel: get('c-panel') });
    parent.open(); child.open();
    const nested = parent.isOpen && child.isOpen;
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    const escape = parent.isOpen && !child.isOpen && document.activeElement === get('c-trigger');
    child.open(); get('c-panel').querySelector('button:not(:disabled)').click();
    const selected = !child.isOpen && parent.isOpen;
    child.open(); parent.close();
    const cascaded = !parent.isOpen && !child.isOpen;
    parent.destroy(); get('p-trigger').click();
    const destroyed = !parent.isOpen;
    child.destroy();
    const tip = bindTooltip({ trigger: get('tip-trigger'), panel: get('tip-panel') });
    get('tip-trigger').focus();
    const tooltip = tip.isOpen && document.activeElement === get('tip-trigger');
    tip.destroy();
    const description = get('tip-trigger').getAttribute('aria-describedby');
    get('tip-trigger').dispatchEvent(new Event('pointerenter'));
    const noListeners = !tip.isOpen;
    const control = get('p-trigger');
    setButtonBusy(control, true); setButtonBusy(control, true);
    const keptLabel = control.textContent === 'Parent';
    setButtonBusy(control, false);
    const restored = !control.disabled && !control.hasAttribute('aria-busy') && control.textContent === 'Parent';
    host.remove();
    return { nested, escape, selected, cascaded, destroyed, tooltip, description, noListeners, keptLabel, restored };
  });
  expect(result).toEqual({ nested:true, escape:true, selected:true, cascaded:true, destroyed:true, tooltip:true, description:'existing', noListeners:true, keptLabel:true, restored:true });
});
