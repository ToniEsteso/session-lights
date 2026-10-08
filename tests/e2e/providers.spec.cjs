const { test, expect } = require('./fixtures.cjs');

async function openEmptySettings(page) {
  await page.getByRole('button', { name: 'No sessions. Show session list.', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
}

test('one Codex switch controls desktop, CLI, and usage; Claude stays independent', async ({ lights }) => {
  await lights.claudeRecord({ type: 'user', message: { content: 'Claude task' } });
  await lights.expand();
  const page = lights.page;
  await expect(page.getByRole('listitem')).toHaveCount(4);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('switch')).toHaveCount(2);
  await expect(page.getByRole('switch', { name: 'Codex', exact: true })).toBeChecked();
  await expect(page.getByRole('switch', { name: 'Claude', exact: true })).toBeChecked();
  await page.getByRole('switch', { name: 'Codex', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Back to threads', exact: true }).click();
  await expect(page.getByRole('listitem')).toHaveText([/Claude task/]);
  const limits = page.getByRole('region', { name: 'Usage limits', exact: true }).getByRole('progressbar');
  await expect(limits).toHaveCount(2);
  await expect(limits.first()).toHaveAttribute('aria-label', /^Claude · /);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('switch', { name: 'Codex', exact: true }).check();
  await page.getByRole('switch', { name: 'Claude', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Back to threads', exact: true }).click();
  await expect(page.getByRole('listitem')).toHaveCount(3);
  await expect(limits).toHaveCount(2);
  await expect(limits.first()).toHaveAttribute('aria-label', /^Codex · /);
  await expect(page.getByRole('button', { name: 'Build API: Working', exact: true }).getByText('Codex Desktop', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Build API: Working', exact: true })).toHaveAttribute('aria-description', /Codex Desktop/);
  await expect(page.getByRole('button', { name: 'Fix CLI: Idle', exact: true }).getByText('Codex CLI', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fix CLI: Idle', exact: true })).toHaveAttribute('aria-description', /Codex CLI/);
  await expect(page.getByText('Unavailable', { exact: true })).toHaveCount(2);
});

test('old CLI pins and hidden sessions migrate; the combined switch stays saved after restart', async ({ lights }) => {
  await lights.restartWithPreferences({
    theme: 'dark', sortOrder: 'project', hiddenAdapters: ['codex'],
    pinned: [`codex-cli:${lights.ids.cli}`, `codex:${lights.ids.cli}`],
    hidden: [`codex-cli:${lights.ids.cli}`],
  });
  await lights.expand();
  let page = lights.page;
  await expect(page.getByRole('listitem')).toHaveText([/Build API/, /Review release/]);
  await expect(page.getByRole('button', { name: 'Group by project', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '1 session hidden', exact: true }).click();
  await page.getByRole('button', { name: 'Restore Fix CLI', exact: true }).click();
  await expect(page.getByRole('listitem').first()).toContainText('Fix CLI');
  await expect(page.getByRole('button', { name: 'Unpin Fix CLI', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await lights.restart();
  await lights.expand();
  page = lights.page;
  await expect(page.getByRole('listitem').first()).toContainText('Fix CLI');
  await expect(page.getByRole('listitem')).toHaveCount(3);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
  await page.getByRole('switch', { name: 'Codex', exact: true }).uncheck();
  await page.getByRole('switch', { name: 'Claude', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Back to threads', exact: true }).click();
  await expect(page.getByText('All sources are hidden.', { exact: true })).toBeVisible();
  await lights.restart();
  page = lights.page;
  await page.getByRole('button', { name: 'All sources are hidden. Open Settings.', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Codex', exact: true })).not.toBeChecked();
  await page.getByRole('switch', { name: 'Codex', exact: true }).check();
  await page.getByRole('button', { name: 'Back to threads', exact: true }).click();
  await expect(page.getByRole('listitem').first()).toContainText('Fix CLI');
  await expect(page.getByRole('listitem')).toHaveCount(3);
});

test('old Codex visibility choices migrate; a failed preference write keeps the saved choice and can recover', async ({ lights }) => {
  for (const hiddenAdapters of [[], ['codex-cli'], ['codex', 'codex-cli']]) {
    await lights.restartWithPreferences({ hiddenAdapters });
    const page = lights.page;
    if (hiddenAdapters.length === 2) {
      await openEmptySettings(page);
    } else {
      await lights.expand();
      await expect(page.getByRole('listitem')).toHaveCount(3);
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
    }
    await expect(page.getByRole('switch', { name: 'Codex', exact: true })).toBeChecked({ checked: hiddenAdapters.length !== 2 });
  }
  let page = lights.page;
  await lights.setPreferenceWriteFailure(true);
  await page.getByRole('switch', { name: 'Codex', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Codex', exact: true })).not.toBeChecked();
  await lights.restart();
  page = lights.page;
  await openEmptySettings(page);
  await expect(page.getByRole('switch', { name: 'Codex', exact: true })).not.toBeChecked();
  await lights.setPreferenceWriteFailure(false);
  await page.getByRole('switch', { name: 'Codex', exact: true }).check();
  await page.getByRole('button', { name: 'Back to threads', exact: true }).click();
  await expect(page.getByRole('listitem')).toHaveCount(3);
  await lights.restart();
  await lights.expand();
  await expect(lights.page.getByRole('listitem')).toHaveCount(3);
});
