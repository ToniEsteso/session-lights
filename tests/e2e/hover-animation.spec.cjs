const { test, expect } = require('./fixtures.cjs');

test('hover resize keeps the panel anchored to the screen edge', async ({ lights }) => {
  const page = lights.page;
  await lights.setReducedMotion(false);
  await page.mouse.move(-20, -20);
  const compact = await lights.panelBounds();
  const rightEdge = bounds => bounds.x + bounds.surface.x + bounds.surface.width;
  const topEdge = bounds => bounds.y + bounds.surface.y;
  const isExpanded = bounds => bounds.width > compact.width && Math.abs(bounds.surface.width - bounds.width) <= 1;
  const isCompact = bounds => bounds.width <= compact.width + 1 && bounds.surface.width <= compact.surface.width + 1;

  await page.getByRole('list', { name: 'Sessions', exact: true }).hover();
  const expanding = await lights.samplePanelBoundsUntil(isExpanded);
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  expect(expanding.at(-1).width).toBeGreaterThan(compact.width);
  for (const bounds of expanding) {
    expect(Math.abs(rightEdge(bounds) - rightEdge(compact))).toBeLessThanOrEqual(1);
    expect(bounds.y).toBe(compact.y);
    expect(topEdge(bounds)).toBe(topEdge(compact));
  }

  await page.mouse.move(-20, -20);
  const collapsing = await lights.samplePanelBoundsUntil(isCompact);
  expect(collapsing.at(-1).width).toBeLessThanOrEqual(compact.width + 1);
  for (const bounds of collapsing) {
    expect(Math.abs(rightEdge(bounds) - rightEdge(compact))).toBeLessThanOrEqual(1);
    expect(topEdge(bounds)).toBe(topEdge(compact));
  }

  await page.getByRole('list', { name: 'Sessions', exact: true }).hover();
  const starting = await lights.samplePanelBoundsUntil(bounds => bounds.width > compact.width && bounds.surface.width > compact.surface.width);
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await page.mouse.move(-20, -20);
  const reversed = await lights.samplePanelBoundsUntil(isCompact);
  expect(reversed.at(-1).width).toBeLessThanOrEqual(compact.width + 1);
  for (const bounds of [...starting, ...reversed]) {
    expect(Math.abs(rightEdge(bounds) - rightEdge(compact))).toBeLessThanOrEqual(1);
    expect(topEdge(bounds)).toBe(topEdge(compact));
  }
});
