const { test, expect } = require('./fixtures.cjs');

test('hover resize keeps the panel anchored to the screen edge', async ({ lights }) => {
  const page = lights.page;
  await lights.setReducedMotion(false);
  await page.mouse.move(-20, -20);
  const compact = await lights.panelBounds();
  const rightEdge = bounds => bounds.x + bounds.surface.x + bounds.surface.width;
  const topEdge = bounds => bounds.y + bounds.surface.y;

  await page.getByRole('list', { name: 'Sessions', exact: true }).hover();
  const expanding = await lights.samplePanelBounds(420);
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  expect(expanding.at(-1).width).toBeGreaterThan(compact.width);
  for (const bounds of expanding) {
    expect(Math.abs(rightEdge(bounds) - rightEdge(compact))).toBeLessThanOrEqual(1);
    expect(bounds.y).toBe(compact.y);
    expect(topEdge(bounds)).toBe(topEdge(compact));
  }

  await page.mouse.move(-20, -20);
  const collapsing = await lights.samplePanelBounds(420);
  expect(collapsing.at(-1).width).toBeLessThanOrEqual(compact.width + 1);
  for (const bounds of collapsing) {
    expect(Math.abs(rightEdge(bounds) - rightEdge(compact))).toBeLessThanOrEqual(1);
    expect(topEdge(bounds)).toBe(topEdge(compact));
  }

  await page.getByRole('list', { name: 'Sessions', exact: true }).hover();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await lights.samplePanelBounds(70);
  await page.mouse.move(-20, -20);
  const reversed = await lights.samplePanelBounds(420);
  expect(reversed.at(-1).width).toBeLessThanOrEqual(compact.width + 1);
  for (const bounds of reversed) {
    expect(Math.abs(rightEdge(bounds) - rightEdge(compact))).toBeLessThanOrEqual(1);
    expect(topEdge(bounds)).toBe(topEdge(compact));
  }
});