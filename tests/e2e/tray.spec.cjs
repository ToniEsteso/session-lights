const { test, expect } = require('./fixtures');

async function openSettings(lights) {
  await lights.expand();
  await lights.page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(lights.page.getByRole('heading', { name: 'Settings' })).toBeVisible();
}

test('a hidden panel stays hidden after a restart and a second launch brings it back', async ({ lights }) => {
  await openSettings(lights);
  await lights.page.getByRole('button', { name: 'Hide panel', exact: true }).click();
  await expect.poll(lights.nativeVisible, { message: 'Hide must remove the panel from the screen' }).toBe(false);

  await lights.restart({ hidden: true });
  await lights.waitForStartup();
  expect(await lights.nativeVisible(), 'A panel that the user hid must not reappear after a restart').toBe(false);

  await lights.launchAgain();
  await expect.poll(lights.nativeVisible, { message: 'Starting the app again must show the hidden panel' }).toBe(true);
  // The panel returns as the compact bar, not as the Settings view that was open when it was hidden.
  await expect(lights.page.getByRole('heading', { name: 'Settings' })).toBeHidden();

  await lights.restart();
  expect(await lights.nativeVisible(), 'A panel that the user showed again must start visible').toBe(true);
});

test('Start at login saves the choice, follows changes made outside the app, and survives a restart', async ({ lights }) => {
  await openSettings(lights);
  const login = lights.page.getByRole('switch', { name: 'Start at login' });
  await expect(login).not.toBeChecked();
  await login.check();
  await expect.poll(lights.loginItem, { message: 'The switch must register the app to start at login' }).toBe(true);

  await lights.restart();
  await openSettings(lights);
  await expect(lights.page.getByRole('switch', { name: 'Start at login' }), 'The choice must survive a restart').toBeChecked();

  // The user turns the item off in the system. Settings must show the real state when it opens again.
  await lights.setLoginItemOutsideApp(false);
  await lights.page.getByRole('button', { name: 'Back to threads' }).click();
  await openSettings(lights);
  await expect(lights.page.getByRole('switch', { name: 'Start at login' })).not.toBeChecked();

  await lights.page.getByRole('switch', { name: 'Start at login' }).check();
  await lights.page.getByRole('switch', { name: 'Start at login' }).uncheck();
  await expect.poll(lights.loginItem, { message: 'Turning the switch off must remove the registration' }).toBe(false);
});
