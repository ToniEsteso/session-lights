const { test, expect } = require('./fixtures.cjs');

test('Claude Code appears without an installation; new records appear and its switch persists', async ({ lights }) => {
  await lights.expand();
  let page = lights.page;
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Claude Code', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Back to threads', exact: true }).click();
  await expect(page.getByRole('listitem')).toHaveCount(3);
  await lights.claudeRecord({ type: 'user', message: { role: 'user', content: 'Build Claude API' } });
  await expect(page.getByRole('button', { name: 'Build Claude API: Working', exact: true })).toBeVisible();
  await lights.claudeRecord({ type: 'assistant', message: {
    role: 'assistant', content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn',
  } });
  await expect(page.getByRole('button', { name: 'Build Claude API: Idle', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Build Claude API: Idle', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Claude Code not found. Install Claude Code and add it to PATH.');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('switch', { name: 'Claude Code', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Back to threads', exact: true }).click();
  await expect(page.getByRole('listitem')).toHaveCount(3);
  await lights.restart();
  await lights.expand();
  page = lights.page;
  await expect(page.getByRole('listitem')).toHaveCount(3);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Claude Code', exact: true })).not.toBeChecked();
  await page.getByRole('switch', { name: 'Claude Code', exact: true }).check();
  await page.getByRole('button', { name: 'Back to threads', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Build Claude API: Idle', exact: true })).toBeVisible();
});

test('Claude transcript activity changes states; old, partial, and subagent data do not claim live work', async ({ lights }) => {
  await lights.claudeRecord({ type: 'user', message: { content: 'Build Claude API' } });
  await lights.claudeRecord({ type: 'user', timestamp: new Date(Date.now() - 20 * 60_000).toISOString(),
    message: { content: 'Old Claude task' } }, lights.ids.claudeOld);
  await lights.claudeRecord({ type: 'custom-title', customTitle: 'Old Claude task' }, lights.ids.claudeOld);
  await lights.claudeRecord({ type: 'user', isSidechain: true,
    message: { content: 'Internal Claude agent' } }, lights.ids.claudeAgent);
  await lights.expand();
  const page = lights.page;
  await expect(page.getByRole('button', { name: 'Build Claude API: Working', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Old Claude task: Unknown', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Internal Claude agent:/ })).toHaveCount(0);
  await lights.claudeRecord({ type: 'assistant', message: { content: [
    { type: 'tool_use', id: 'question-1', name: 'AskUserQuestion', input: { questions: [] } },
  ], stop_reason: 'tool_use' } });
  await expect(page.getByRole('button', { name: 'Build Claude API: Needs you', exact: true })).toBeVisible();
  await lights.claudeRecord({ type: 'user', message: { content: [
    { type: 'tool_result', tool_use_id: 'background-tool', content: 'Background complete' },
  ] } });
  // A completed unrelated tool must leave the pending question visible.
  await lights.claudeRecord({ type: 'custom-title', customTitle: 'Claude question' });
  await expect(page.getByRole('button', { name: 'Claude question: Needs you', exact: true })).toBeVisible();
  await lights.claudeRecord({ type: 'user', message: { content: [
    { type: 'tool_result', tool_use_id: 'question-1', content: 'Continue' },
  ] } });
  await expect(page.getByRole('button', { name: 'Claude question: Working', exact: true })).toBeVisible();
  await lights.claudeRecord({ type: 'assistant', isApiErrorMessage: true,
    message: { content: [{ type: 'text', text: 'API error' }], stop_reason: null } });
  await expect(page.getByRole('button', { name: 'Claude question: Failed', exact: true })).toBeVisible();
  await lights.claudeRecord({ type: 'user', message: { content: 'Retry' } });
  await expect(page.getByRole('button', { name: 'Claude question: Working', exact: true })).toBeVisible();
  await lights.claudeRecord({ type: 'assistant', message: {
    content: [{ type: 'text', text: 'Response with no completion marker' }], stop_reason: null,
  } });
  await expect(page.getByRole('button', { name: 'Claude question: Unknown', exact: true })).toBeVisible();
  await lights.claudeRecord({ type: 'system', subtype: 'turn_duration', durationMs: 1000 });
  await expect(page.getByRole('button', { name: 'Claude question: Idle', exact: true })).toBeVisible();
  await lights.claudeRaw('{"type":"assistant",');
  await lights.claudeRaw('\n');
  await lights.claudeRecord({ type: 'custom-title', customTitle: 'Recovered Claude record' });
  await expect(page.getByRole('button', { name: 'Recovered Claude record: Idle', exact: true })).toBeVisible();
  await lights.removeClaudeRecord();
  await expect(page.getByRole('button', { name: /Recovered Claude record:/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Build API: Working', exact: true })).toBeVisible();
  await lights.claudeRecord({ type: 'user', message: { content: 'Restored Claude task' } });
  await lights.claudeRecord({ type: 'user', message: { content: '[Request interrupted by user]' } });
  await expect(page.getByRole('button', { name: 'Restored Claude task: Idle', exact: true })).toBeVisible();
});
