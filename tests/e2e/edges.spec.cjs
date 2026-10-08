const { test, expect } = require('./fixtures.cjs');

// Requirement: Settings > Position moves the panel to the left, top, bottom, or right
// screen edge. The compact bar lies along that edge, the panel opens against it, and
// the choice survives a restart. Detects a panel that stays on the right, a bar that
// keeps the vertical shape on a top or bottom edge, and a choice that is not saved.
test('the panel moves to each screen edge and keeps the choice after restart', async ({ lights }, testInfo) => {
  // Distance from each side of the visible panel to the same side of the screen work area.
  const placement = () => lights.page.evaluate(() => {
    const rect = document.querySelector('#panel').getBoundingClientRect();
    const area = window.screen;
    const left = window.screenX + rect.left, top = window.screenY + rect.top;
    return { left: Math.round(left - area.availLeft), top: Math.round(top - area.availTop),
      right: Math.round(area.availLeft + area.availWidth - left - rect.width),
      bottom: Math.round(area.availTop + area.availHeight - top - rect.height),
      width: Math.round(rect.width), height: Math.round(rect.height) };
  });
  const expectOnEdge = async (edge, shape) => {
    await expect.poll(async () => {
      const value = await placement();
      const along = edge === 'left' || edge === 'right' ? value.height > value.width : value.width > value.height;
      return { edgeGap: value[edge], compactShape: shape === 'compact' ? along : 'not checked' };
    }, { message: `The ${shape} panel must touch the ${edge} screen edge` })
      .toEqual({ edgeGap: 0, compactShape: shape === 'compact' ? true : 'not checked' });
  };
  const collapse = async () => {
    await lights.page.mouse.move(-20, -20);
    await expect(lights.page.getByRole('button', { name: 'Settings', exact: true })).toBeHidden();
  };
  const shot = name => lights.page.screenshot({ path: testInfo.outputPath(`${name}.png`), omitBackground: true });
  const chooseEdge = async label => {
    await lights.expand();
    await lights.page.getByRole('button', { name: 'Settings', exact: true }).click();
    await lights.page.getByRole('radio', { name: label, exact: true }).check();
    await expectOnEdge(label.toLowerCase(), 'expanded');
    await shot(`${label.toLowerCase()}-settings`);
    await lights.page.getByRole('button', { name: 'Back to threads', exact: true }).click();
  };
  const checkEdge = async label => {
    const edge = label.toLowerCase();
    await collapse();
    await expectOnEdge(edge, 'compact');
    await shot(`${edge}-compact`);
    await lights.expand();
    await expectOnEdge(edge, 'expanded');
    await expect(lights.page.getByRole('button', { name: /^Build API/ })).toBeVisible();
    await shot(`${edge}-expanded`);
  };

  await expectOnEdge('right', 'compact');
  for (const label of ['Left', 'Top', 'Bottom']) {
    await chooseEdge(label);
    await checkEdge(label);
  }
  await lights.restart();
  await expectOnEdge('bottom', 'compact');
  await chooseEdge('Right');
  await checkEdge('Right');
});
