const { test, expect } = require('./fixtures.cjs');

// Start with three Codex sessions. Add a fourth local session from Claude.
// At standard desktop text size, the native panel must grow to show this short
// list and the account limits of both providers without clipping the last row behind the footer.
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
  await expect(limits).toHaveCount(4);
  for (let index = 0; index < 4; index++) await expect(limits.nth(index)).toBeInViewport({ ratio: 1 });
});

// Start with three recent sessions, one thread from 23 hours ago, and one from two days ago.
// Detect an old thread in the list, a pinned old thread that disappears, or new activity that does not bring it back.
test('the list shows the last 24 hours and pinned sessions; new activity brings an old thread back', async ({ lights }) => {
  const hour = 3_600_000;
  await lights.codexThread(lights.ids.recent, 'Recent notes', Date.now() - 23 * hour);
  await lights.codexThread(lights.ids.old, 'Archive notes', Date.now() - 48 * hour);
  await lights.expand();
  let page = lights.page;
  const rows = () => page.getByRole('list', { name: 'Sessions', exact: true }).getByRole('listitem');
  // The thread from 23 hours ago comes from the same read, so the old thread had its chance to appear.
  await expect(rows()).toHaveText([/Build API/, /Review release/, /Fix CLI/, /Recent notes/]);
  await lights.restartWithPreferences({ pinned: [`codex:${lights.ids.old}`] });
  await lights.expand();
  page = lights.page;
  await expect(rows()).toHaveText([/Archive notes/, /Build API/, /Review release/, /Fix CLI/, /Recent notes/]);
  await page.getByRole('button', { name: 'Unpin Archive notes', exact: true }).click();
  await expect(rows()).toHaveText([/Build API/, /Review release/, /Fix CLI/, /Recent notes/]);
  await lights.record(lights.ids.old, 'event_msg', { type: 'task_started' });
  await expect(rows()).toHaveText([/Archive notes/, /Build API/, /Review release/, /Fix CLI/, /Recent notes/]);
  await expect(page.getByRole('button', { name: 'Archive notes: Working', exact: true })).toBeVisible();
});

// Start with three sessions in activity order. Local records make two of them need the user.
// Detect a waiting or failed session below newer activity, or a state shown only by color.
test('waiting and failed sessions stay above newer activity with visible state text; recovery restores activity order', async ({ lights }) => {
  await lights.expand();
  const page = lights.page;
  const rows = page.getByRole('list', { name: 'Sessions', exact: true }).getByRole('listitem');
  await expect(rows).toHaveText([/Build API/, /Review release/, /Fix CLI/]);
  await lights.record(lights.ids.cli, 'event_msg', { type: 'task_complete', error: 'Request failed' });
  await expect(page.getByRole('button', { name: 'Fix CLI: Failed', exact: true }).getByText('Failed', { exact: true })).toBeVisible();
  // Newer activity in another session must not move it above the failed session.
  await lights.record(lights.ids.review, 'event_msg', { type: 'task_started' });
  await expect(page.getByRole('button', { name: 'Review release: Working', exact: true })).toBeVisible();
  await expect(rows).toHaveText([/Fix CLI/, /Review release/, /Build API/]);
  await lights.desktopQuestion();
  await expect(page.getByRole('button', { name: 'Build API: Needs you', exact: true }).getByText('Answer needed', { exact: true })).toBeVisible();
  await expect(rows.last()).toContainText('Review release');
  await lights.record(lights.ids.cli, 'event_msg', { type: 'task_started' });
  await lights.record(lights.ids.desktop, 'event_msg', { type: 'task_complete' });
  await expect(page.getByRole('button', { name: 'Build API: Idle', exact: true })).toBeVisible();
  await expect(rows).toHaveText([/Build API/, /Fix CLI/, /Review release/]);
  await expect(page.getByText(/^(Failed|Answer needed)$/)).toHaveCount(0);
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

// Start with three sessions. Hide one, move the pointer away so the panel closes, then open the panel again.
// Detect a "Hidden" message with Undo that is still shown long after the user hid the session.
// The session must stay recoverable from the hidden list.
test('the Undo offer for a hidden session ends when the panel closes', async ({ lights }) => {
  await lights.expand();
  const page = lights.page;
  await page.getByRole('button', { name: 'Hide Review release', exact: true }).click();
  await expect(page.getByText('Hidden: Review release', { exact: true })).toBeVisible();
  await page.mouse.move(-20, -20);
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeHidden();
  await lights.expand();
  await expect(page.getByRole('button', { name: 'Build API: Working', exact: true })).toBeVisible();
  await expect(page.getByText('Hidden: Review release', { exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeHidden();
  await page.getByRole('button', { name: '1 session hidden', exact: true }).click();
  await page.getByRole('button', { name: 'Restore Review release', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review release: Idle', exact: true })).toBeVisible();
});

// Start with three sessions. Use only the keyboard after focus enters the list.
// Detect arrow keys that lose the list or an Enter that opens the wrong chat.
test('arrow keys move between sessions and Enter opens the focused chat', async ({ lights }) => {
  await lights.expand();
  const page = lights.page;
  await page.getByRole('button', { name: 'Build API: Working', exact: true }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Review release: Idle', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Fix CLI: Idle', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect.poll(() => lights.openedChats()).toEqual([`codex://threads/${lights.ids.review}`]);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('button', { name: 'Build API: Working', exact: true })).toBeFocused();
});

// Start with an idle Codex CLI chat and a Claude chat with an older finished turn. Each provider records a
// turn start in the past. The open panel must show how long the current turn has run, not the last
// activity, the first prompt, or a tool result. Detect a duration that stays after the turn completes.
test('a working session shows how long its current turn has run', async ({ lights }) => {
  const minute = 60_000, now = Date.now();
  await lights.record(lights.ids.cli, 'event_msg', { type: 'task_started', turn_id: 'turn-2' }, now - 7.5 * minute);
  await lights.claudeRecord({ type: 'user', message: { content: 'Migrate the schema' }, timestamp: new Date(now - 70 * minute).toISOString() });
  await lights.claudeRecord({ type: 'assistant', message: { model: 'claude-opus-4-6', content: 'Done.', stop_reason: 'end_turn' }, timestamp: new Date(now - 65 * minute).toISOString() });
  await lights.claudeRecord({ type: 'user', message: { content: 'Now run the backfill' }, timestamp: new Date(now - 62.5 * minute).toISOString() });
  await lights.claudeRecord({ type: 'assistant', message: { model: 'claude-opus-4-6', content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: {} }], stop_reason: 'tool_use' }, timestamp: new Date(now - 2 * minute).toISOString() });
  await lights.claudeRecord({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'ok' }] }, timestamp: new Date(now - minute).toISOString() });
  await lights.expand();
  const page = lights.page;
  const row = name => page.getByRole('listitem').filter({ has: page.getByRole('button', { name, exact: true }) });
  await expect(row('Fix CLI: Working').getByLabel(/^Working for/), 'the Codex turn started 7.5 minutes ago').toHaveText('7m');
  await expect(page.getByRole('button', { name: 'Fix CLI: Working', exact: true })).toHaveAttribute('aria-description', /Working for 7m/);
  await expect(row('Migrate the schema: Working').getByLabel(/^Working for/), 'the second Claude prompt started the turn').toHaveText('1h 2m');
  await expect(row('Review release: Idle').getByLabel(/^Working for/)).toHaveCount(0);
  await lights.page.screenshot({ path: test.info().outputPath('turn-durations.png') });

  await lights.record(lights.ids.cli, 'event_msg', { type: 'task_complete', turn_id: 'turn-2' });
  await expect(row('Fix CLI: Idle').getByLabel(/^Last activity/)).toHaveText('just now');
  await expect(row('Fix CLI: Idle').getByLabel(/^Working for/)).toHaveCount(0);
});
