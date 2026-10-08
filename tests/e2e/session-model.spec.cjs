const { test, expect } = require('./fixtures.cjs');

// Detect missing or stale project, adapter, and model names in the row tooltip.
// Start with local sessions, update real records, then group and restart.
test('row tooltips show projects, adapters, and saved models across updates and restart', async ({ lights }, testInfo) => {
  await lights.expand();
  let page = lights.page;
  const desktop = () => page.getByRole('button', { name: 'Build API: Working', exact: true });
  const cli = () => page.getByRole('button', { name: 'Fix CLI: Idle', exact: true });
  const review = () => page.getByRole('button', { name: 'Review release: Idle', exact: true });
  await expect(review()).toHaveAttribute('title', 'Review release\nwebsite · Codex Desktop');
  await expect(cli()).toHaveAttribute('title', /\ntools · Codex CLI$/);
  await expect(review()).toHaveAttribute('aria-description', /Codex Desktop/);
  await expect(review()).not.toHaveAttribute('aria-description', /Model:/);
  await page.screenshot({ path: testInfo.outputPath('activity-rows.png') });
  await page.getByRole('button', { name: 'Group by project', exact: true }).click();
  await expect(page.getByText('service', { exact: true })).toBeVisible();
  await expect(desktop()).toHaveAttribute('title', /service · Codex Desktop/);
  await page.screenshot({ path: testInfo.outputPath('project-rows.png') });
  await page.getByRole('button', { name: 'Group by project', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Theme', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Sources', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('settings-labels.png') });
  await page.getByRole('button', { name: 'Back to threads', exact: true }).click();
  await lights.expand();

  // Old databases have no model column. Turn records still identify CLI models.
  await lights.record(lights.ids.cli, 'turn_context', { model: 'gpt-5.6-sol' });
  await expect(cli()).toHaveAttribute('aria-description', /Model: gpt-5.6-sol/);
  await expect(cli()).toHaveAttribute('title', /Codex CLI · gpt-5.6-sol/);
  await lights.record(lights.ids.cli, 'turn_context', { model: 'gpt-6.1-sol' });
  await expect(cli()).toHaveAttribute('aria-description', /Model: gpt-6.1-sol/);
  await expect(cli()).toHaveAttribute('title', /Codex CLI · gpt-6.1-sol/);
  await expect(cli()).not.toHaveAttribute('aria-description', /gpt-5.6-sol/);
  await lights.record(lights.ids.cli, 'turn_context', { model: 42 });
  await lights.record(lights.ids.cli, 'event_msg', { type: 'task_complete', model: 'not-a-turn-model' });
  await expect(cli()).toHaveAttribute('aria-description', /Model: gpt-6.1-sol/);
  await expect(cli()).not.toHaveAttribute('aria-description', /not-a-turn-model/);

  // The saved session model takes priority over old turn history.
  await lights.record(lights.ids.desktop, 'turn_context', { model: 'gpt-5.6-sol' });
  await lights.databaseModel(lights.ids.desktop, 'gpt-6-astra');
  await expect(desktop()).toHaveAttribute('aria-description', /Model: gpt-6-astra/);
  await expect(desktop()).toHaveAttribute('title', /Codex Desktop · gpt-6-astra/);
  await expect(desktop()).not.toHaveAttribute('aria-description', /gpt-5.6-sol/);
  await lights.claudeRecord({ type: 'user', message: { content: 'Claude model task' } });
  await lights.claudeRecord({ type: 'assistant', message: { model: 'claude-sonnet-4-6', content: 'Done.', stop_reason: 'end_turn' } });
  const claude = () => page.getByRole('button', { name: 'Claude model task: Idle', exact: true });
  await expect(claude()).toHaveAttribute('aria-description', /Model: claude-sonnet-4-6/);
  await expect(claude()).toHaveAttribute('title', /Claude · claude-sonnet-4-6/);
  await lights.claudeRecord({ type: 'assistant', message: { model: 'claude-opus-4-6', content: 'Done again.', stop_reason: 'end_turn' } });
  await lights.claudeRecord({ type: 'assistant', isSidechain: true, message: { model: 'subagent-model', content: 'Internal agent', stop_reason: 'end_turn' } }, lights.ids.claudeAgent);
  await lights.claudeRecord({ type: 'assistant', sessionId: lights.ids.claudeAgent, message: { model: 'another-session-model' } });
  await lights.claudeRecord({ type: 'assistant', message: { model: '<synthetic>', content: 'Done.', stop_reason: 'end_turn' } });
  await expect(claude()).toHaveAttribute('aria-description', /Model: claude-opus-4-6/);
  await expect(claude()).toHaveAttribute('title', /Claude · claude-opus-4-6/);
  await expect(claude()).not.toHaveAttribute('aria-description', /claude-sonnet-4-6/);
  await expect(claude()).not.toHaveAttribute('aria-description', /subagent-model/);
  await expect(claude()).not.toHaveAttribute('aria-description', /another-session-model/);
  await expect(claude()).not.toHaveAttribute('aria-description', /<synthetic>/);
  await expect(review()).not.toHaveAttribute('aria-description', /Model:/);
  await page.screenshot({ path: testInfo.outputPath('session-models.png') });

  const longModel = 'custom-provider/gpt-6.1-sol-with-a-long-deployment-name';
  await lights.databaseModel(lights.ids.desktop, longModel);
  await expect(desktop()).toHaveAttribute('aria-description', new RegExp('Model: ' + longModel));
  await expect(desktop()).toHaveAttribute('title', new RegExp(longModel));

  await lights.removeRecord(lights.ids.desktop);
  await expect(page.getByRole('button', { name: 'Build API: Unknown', exact: true })).toHaveAttribute('aria-description', new RegExp('Model: ' + longModel));
  await expect(page.getByRole('button', { name: 'Build API: Unknown', exact: true })).toHaveAttribute('title', new RegExp(longModel));
  await lights.record(lights.ids.desktop, 'event_msg', { type: 'task_started' });
  await expect(desktop()).toHaveAttribute('aria-description', new RegExp('Model: ' + longModel));
  await lights.restart();
  await lights.expand();
  page = lights.page;
  await expect(desktop()).toHaveAttribute('aria-description', new RegExp('Model: ' + longModel));
  await expect(desktop()).toHaveAttribute('title', new RegExp(longModel));
  await expect(cli()).toHaveAttribute('title', /gpt-6.1-sol/);
  await expect(claude()).toHaveAttribute('title', /claude-opus-4-6/);
  await expect(cli()).toHaveAttribute('aria-description', /Model: gpt-6.1-sol/);
  await expect(claude()).toHaveAttribute('aria-description', /Model: claude-opus-4-6/);
  await expect(review()).not.toHaveAttribute('aria-description', /Model:/);
});
