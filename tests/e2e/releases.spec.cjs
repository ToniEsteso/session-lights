const { test, expect } = require('./fixtures.cjs');

// Start with local sessions. Opening downloads must reach GitHub. An OS launch
// failure must be visible, and a retry must recover without restarting the app.
test('manual updates open GitHub; a failed browser handoff can be retried', async ({ lights }) => {
  await lights.expand();
  const page = lights.page;
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByText('Download and run the latest installer to update.', { exact: true })).toBeVisible();
  const downloads = page.getByRole('button', { name: 'Downloads on GitHub', exact: true });
  await downloads.click();
  await expect.poll(() => lights.openedChats()).toEqual(['https://github.com/ToniEsteso/session-lights/releases']);
  await lights.setOpenFailure(true);
  await downloads.click();
  await expect(page.getByRole('alert')).toContainText('Could not open GitHub.');
  await lights.setOpenFailure(false);
  await downloads.click();
  await expect.poll(() => lights.openedChats()).toHaveLength(2);
  await expect(page.getByRole('alert')).toBeHidden();
  await page.getByRole('button', { name: 'Back to threads', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Build API: Working', exact: true })).toBeVisible();
});
