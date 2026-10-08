const { test, expect } = require('./fixtures.cjs');

// Start with three Codex sessions. Add a fourth local session from Claude.
// At standard desktop text size, the native panel must grow to show this short
// list and its account limits without clipping the last row behind the footer.
test('a short session list stays fully visible above the account limits', async ({ lights }) => {
  await lights.expand();
  await lights.claudeRecord({ type: 'user', message: { content: 'Check the release notes' } });
  const page = lights.page;
  const rows = page.getByRole('list', { name: 'Sessions', exact: true }).getByRole('listitem');
  await expect(rows).toHaveCount(4);
  for (const title of ['Build API: Working', 'Review release: Idle', 'Fix CLI: Idle', 'Check the release notes: Working']) {
    await expect(page.getByRole('button', { name: title, exact: true }), `${title} must fit above the fixed usage section`).toBeInViewport({ ratio: 1 });
  }
  const limits = page.getByRole('region', { name: 'Usage limits', exact: true }).getByRole('progressbar');
  await expect(limits).toHaveCount(2);
  await expect(limits.nth(0)).toBeInViewport({ ratio: 1 });
  await expect(limits.nth(1)).toBeInViewport({ ratio: 1 });
});

// Start with three local sessions. Search by saved metadata, then clear the query.
// Detect missing matches, lost keyboard focus, or a filter that hides compact lights.
test('search finds sessions by title, project, source, and saved model; clear restores the list', async ({ lights }) => {
  await lights.expand();
  const page = lights.page;
  const search = page.getByRole('searchbox', { name: 'Search sessions', exact: true });
  const rows = page.getByRole('listitem');
  await page.keyboard.press('ControlOrMeta+f');
  await expect(search).toBeFocused();
  await search.fill('review');
  await expect(rows).toHaveText([/Review release/]);
  await expect(search).toBeFocused();
  await search.fill('WEBSITE');
  await expect(rows).toHaveText([/Review release/]);
  await search.fill('Codex CLI');
  await expect(rows).toHaveText([/Fix CLI/]);
  await lights.record(lights.ids.cli, 'turn_context', { model: 'gpt-6.1-sol' });
  await search.fill('gpt-6.1-sol');
  await expect(rows).toHaveText([/Fix CLI/]);
  await expect(search).toBeFocused();
  await search.fill('absent session');
  await expect(rows).toHaveCount(0);
  await expect(page.getByText('No matching sessions', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show all sessions', exact: true }).click();
  await expect(rows).toHaveText([/Fix CLI/, /Build API/, /Review release/]);
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await search.fill('review');
  await page.keyboard.press('Escape');
  await expect(search).toHaveValue('');
  await expect(rows).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await search.fill('review');
  await page.mouse.move(-20, -20);
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeHidden();
  await expect(rows).toHaveCount(3);
  await lights.expand();
  await expect(rows).toHaveText([/Review release/]);
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(rows).toHaveCount(3);
});

// Start without waiting or failed turns. External local records change those states.
// Detect incorrect attention membership, stale counts, or states communicated only by color.
test('attention filter follows live waiting, failure, and recovery with visible state labels', async ({ lights }) => {
  await lights.expand();
  const page = lights.page;
  const attention = page.getByRole('button', { name: /^Attention / });
  await attention.click();
  await expect(page.getByText('No sessions need attention', { exact: true })).toBeVisible();
  await lights.desktopQuestion();
  const waiting = page.getByRole('button', { name: 'Build API: Needs you', exact: true });
  await expect(page.getByRole('listitem')).toHaveText([/Build API/]);
  await expect(waiting.getByText('Needs you', { exact: true })).toBeVisible();
  await expect(attention).toHaveText('Attention 1');
  await lights.record(lights.ids.cli, 'event_msg', { type: 'task_complete', error: 'Request failed' });
  const failed = page.getByRole('button', { name: 'Fix CLI: Failed', exact: true });
  await expect(failed.getByText('Failed', { exact: true })).toBeVisible();
  await expect(attention).toHaveText('Attention 2');
  await expect(page.getByRole('listitem')).toHaveCount(2);
  await lights.record(lights.ids.desktop, 'event_msg', { type: 'task_complete' });
  await lights.record(lights.ids.cli, 'event_msg', { type: 'task_started' });
  await expect(page.getByRole('listitem')).toHaveCount(0);
  await expect(attention).toHaveText('Attention 0');
  await page.getByRole('button', { name: 'Show all sessions', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Build API: Idle', exact: true }).getByText('Idle', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fix CLI: Working', exact: true }).getByText('Working', { exact: true })).toBeVisible();
});

// Start with a pinned session. Hide, undo, and restart with real saved preferences.
// Detect lost pins, an undo that fails to restore, or success feedback after a failed save.
test('Undo restores a hidden pinned session and failed saves do not show success feedback', async ({ lights }) => {
  await lights.expand();
  let page = lights.page;
  await page.getByRole('button', { name: 'Pin Review release', exact: true }).click();
  await page.getByRole('button', { name: 'Hide Review release', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review release: Idle', exact: true })).toHaveCount(0);
  await expect(page.getByText('Hidden: Review release', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('listitem').first()).toContainText('Review release');
  await expect(page.getByRole('button', { name: 'Review release: Idle', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Unpin Review release', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeHidden();
  await lights.restart();
  await lights.expand();
  page = lights.page;
  await expect(page.getByRole('listitem').first()).toContainText('Review release');
  await lights.setPreferenceWriteFailure(true);
  await page.getByRole('button', { name: 'Hide Review release', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review release: Idle', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeHidden();
  await lights.setPreferenceWriteFailure(false);
  await page.getByRole('button', { name: 'Hide Review release', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('alert')).toBeHidden();
  await expect(page.getByRole('listitem').first()).toContainText('Review release');
});

// Start with three local sessions. Use only the keyboard: search, Enter, and arrow keys.
// Detect an Enter that opens nothing or the wrong chat, and arrow keys that lose the list.
test('keyboard search opens the top match with Enter and arrow keys move between sessions', async ({ lights }) => {
  await lights.expand();
  const page = lights.page;
  const search = page.getByRole('searchbox', { name: 'Search sessions', exact: true });
  await page.keyboard.press('ControlOrMeta+f');
  await expect(search).toBeFocused();
  await page.keyboard.type('review');
  await page.keyboard.press('Enter');
  await expect.poll(() => lights.openedChats()).toEqual([`codex://threads/${lights.ids.review}`]);
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(search).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Build API: Working', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Review release: Idle', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(search).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(() => lights.openedChats()).toEqual([
    `codex://threads/${lights.ids.review}`, `codex://threads/${lights.ids.desktop}`,
  ]);
});

// Defect: a search that shortens the list also shortened the panel. The panel edge
// moved above a pointer resting on a lower row, and the panel closed while the user typed.
// Start with three sessions, rest the pointer on the last row, then search for the first.
test('the panel stays open when a search shortens the list below the pointer', async ({ lights }) => {
  await lights.expand();
  const page = lights.page;
  const last = page.getByRole('button', { name: 'Fix CLI: Idle', exact: true });
  // Rows are at least 52 px tall. Rest the pointer near the bottom of the last row.
  await last.hover({ position: { x: 60, y: 46 } });
  await page.keyboard.press('ControlOrMeta+f');
  await page.keyboard.type('build');
  await expect(page.getByRole('listitem')).toHaveText([/Build API/]);
  // The hover close delay is 120 ms. Wait well past it before checking.
  await page.waitForTimeout(600);
  await expect(page.getByRole('button', { name: 'Settings', exact: true }), 'The panel must stay open while the user types').toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search sessions', exact: true })).toBeFocused();
});
