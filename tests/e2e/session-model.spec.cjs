const { test, expect } = require('./fixtures.cjs');

test('each session shows its saved model; model changes and missing records keep labels correct', async ({ lights }, testInfo) => {
  await lights.expand();
  let page = lights.page;
  const desktop = () => page.getByRole('button', { name: 'Build API: Working', exact: true });
  const cli = () => page.getByRole('button', { name: 'Fix CLI: Idle', exact: true });
  const review = () => page.getByRole('button', { name: 'Review release: Idle', exact: true });
  await expect(review()).toContainText('Codex Desktop');
  await expect(review()).not.toHaveAttribute('aria-description', /Model:/);

  // Old databases have no model column. Turn records still identify CLI models.
  await lights.record(lights.ids.cli, 'turn_context', { model: 'gpt-5.6-sol' });
  await expect(cli()).toContainText('gpt-5.6-sol');
  await lights.record(lights.ids.cli, 'turn_context', { model: 'gpt-6.1-sol' });
  await expect(cli()).toContainText('gpt-6.1-sol');
  await expect(cli()).not.toContainText('gpt-5.6-sol');
  await lights.record(lights.ids.cli, 'turn_context', { model: 42 });
  await lights.record(lights.ids.cli, 'event_msg', { type: 'task_complete', model: 'not-a-turn-model' });
  await expect(cli()).toContainText('gpt-6.1-sol');
  await expect(cli()).not.toContainText('not-a-turn-model');

  // The saved session model takes priority over old turn history.
  await lights.record(lights.ids.desktop, 'turn_context', { model: 'gpt-5.6-sol' });
  await lights.databaseModel(lights.ids.desktop, 'gpt-6-astra');
  await expect(desktop()).toContainText('gpt-6-astra');
  await expect(desktop()).not.toContainText('gpt-5.6-sol');
  await lights.claudeRecord({ type: 'user', message: { content: 'Claude model task' } });
  await lights.claudeRecord({ type: 'assistant', message: { model: 'claude-sonnet-4-6', content: 'Done.', stop_reason: 'end_turn' } });
  const claude = () => page.getByRole('button', { name: 'Claude model task: Idle', exact: true });
  await expect(claude()).toContainText('claude-sonnet-4-6');
  await lights.claudeRecord({ type: 'assistant', message: { model: 'claude-opus-4-6', content: 'Done again.', stop_reason: 'end_turn' } });
  await lights.claudeRecord({ type: 'assistant', isSidechain: true, message: { model: 'subagent-model', content: 'Internal agent', stop_reason: 'end_turn' } }, lights.ids.claudeAgent);
  await lights.claudeRecord({ type: 'assistant', sessionId: lights.ids.claudeAgent, message: { model: 'another-session-model' } });
  await lights.claudeRecord({ type: 'assistant', message: { model: '<synthetic>', content: 'Done.', stop_reason: 'end_turn' } });
  await expect(claude()).toContainText('claude-opus-4-6');
  await expect(claude()).not.toContainText('claude-sonnet-4-6');
  await expect(claude()).not.toContainText('subagent-model');
  await expect(claude()).not.toContainText('another-session-model');
  await expect(claude()).not.toContainText('<synthetic>');
  await expect(review()).not.toHaveAttribute('aria-description', /Model:/);
  await page.screenshot({ path: testInfo.outputPath('session-models.png') });

  const longModel = 'custom-provider/gpt-6.1-sol-with-a-long-deployment-name';
  await lights.databaseModel(lights.ids.desktop, longModel);
  await expect(desktop()).toContainText(longModel);
  await expect(desktop()).toHaveAttribute('aria-description', new RegExp('Model: ' + longModel));
  await page.mouse.move(-20, -20);
  await lights.expand();
  await desktop().hover();
  await expect(lights.tooltip.getByRole('tooltip')).toContainText('Model: ' + longModel);
  await lights.tooltip.screenshot({ path: testInfo.outputPath('full-model-tooltip.png') });
  await page.screenshot({ path: testInfo.outputPath('long-model-row.png') });

  await lights.removeRecord(lights.ids.desktop);
  await expect(page.getByRole('button', { name: 'Build API: Unknown', exact: true })).toContainText(longModel);
  await lights.record(lights.ids.desktop, 'event_msg', { type: 'task_started' });
  await expect(desktop()).toContainText(longModel);
  await lights.restart();
  await lights.expand();
  page = lights.page;
  await expect(desktop()).toContainText(longModel);
  await expect(cli()).toContainText('gpt-6.1-sol');
  await expect(claude()).toContainText('claude-opus-4-6');
  await expect(review()).not.toHaveAttribute('aria-description', /Model:/);
});
