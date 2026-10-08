const { test, expect } = require('./fixtures.cjs');

test('Claude Code appears without an installation; new records appear and its switch persists', async ({ lights }) => {
  await lights.expand();
  let page = lights.page;
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Claude', exact: true })).toBeChecked();
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
  await page.getByRole('switch', { name: 'Claude', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Back to threads', exact: true }).click();
  await expect(page.getByRole('listitem')).toHaveCount(3);
  await lights.restart();
  await lights.expand();
  page = lights.page;
  await expect(page.getByRole('listitem')).toHaveCount(3);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Claude', exact: true })).not.toBeChecked();
  await page.getByRole('switch', { name: 'Claude', exact: true }).check();
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

// Claude prints reset times as "Oct 8, 1:39pm (Zone)", or "10am (Zone)" on the hour. It omits the year.
function claudeReset(at, zone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(at).map(part => [part.type, part.value]));
  const time = `${parts.hour}${parts.minute === '00' ? '' : `:${parts.minute}`}${parts.dayPeriod.toLowerCase()}`;
  return `${parts.month} ${parts.day}, ${time} (${zone})`;
}

test('Claude account limits come from the installed CLI with reset times in the account time zone', async ({ lights }) => {
  const page = lights.page;
  await lights.expand();
  const limits = page.getByRole('region', { name: 'Usage limits', exact: true }).getByRole('progressbar');
  // Without an installation, Claude limits are visible but marked unavailable; Codex limits are separate.
  await expect(limits.filter({ hasText: /^$/ })).toHaveCount(4);
  await expect(page.getByText('Unavailable', { exact: true })).toHaveCount(4);
  const session = Date.now() + 3.5 * 3_600_000, week = Date.now() + (2 * 24 + 5.5) * 3_600_000;
  await lights.installClaude([
    'You are currently using your subscription to power your Claude Code usage', '',
    `Current session: 45% used · resets ${claudeReset(session, 'Asia/Tokyo')}`,
    `Current week (all models): 4% used · resets ${claudeReset(week, 'America/Los_Angeles')}`, '',
    "What's contributing to your limits usage?", 'Last 24h · 139 requests · 3 sessions', ''].join('\n'));
  await lights.restart();
  await lights.expand();
  const five = lights.page.getByRole('progressbar', { name: 'Claude · 5-hour limit remaining', exact: true });
  const weekly = lights.page.getByRole('progressbar', { name: 'Claude · Weekly limit remaining', exact: true });
  await expect(five).toHaveAttribute('aria-valuenow', '55');
  await expect(weekly).toHaveAttribute('aria-valuenow', '96');
  // The same moment in another zone must give the same wait. A zone mistake shifts it by hours.
  await expect(lights.page.getByLabel(/^Resets in 3h (29|30)m$/)).toHaveCount(1);
  await expect(lights.page.getByLabel(/^Resets in 2d 5h$/)).toHaveCount(1);
});

test('a Claude command that is not a chat stays out of the list', async ({ lights }) => {
  // Records written when a command such as /usage runs without a conversation.
  await lights.claudeRecord({ type: 'user', isMeta: true, message: { role: 'user',
    content: '<local-command-caveat>The command below was run directly in Claude Code.</local-command-caveat>' } }, lights.ids.claudeAgent);
  await lights.claudeRecord({ type: 'user', message: { role: 'user',
    content: '<command-name>/usage</command-name>\n<command-message>usage</command-message>' } }, lights.ids.claudeAgent);
  await lights.claudeRecord({ type: 'system', subtype: 'local_command', content: '<local-command-stdout>Current session: 45% used</local-command-stdout>' }, lights.ids.claudeAgent);
  await lights.claudeRecord({ type: 'user', message: { content: 'Real Claude chat' } });
  await lights.expand();
  await expect(lights.page.getByRole('button', { name: 'Real Claude chat: Working', exact: true })).toBeVisible();
  await expect(lights.page.getByRole('listitem')).toHaveCount(4);
  await expect(lights.page.getByRole('button', { name: /Claude Code 66666666/ })).toHaveCount(0);
});

test('a running Claude process reports approval waits; a dead process does not keep a stale state', async ({ lights }) => {
  const entrypoint = 'cli';
  await lights.claudeRecord({ type: 'user', entrypoint, message: { content: 'Run the migration' } });
  await lights.expand();
  const page = lights.page;
  const row = state => page.getByRole('button', { name: `Run the migration: ${state}`, exact: true });
  await expect(row('Working')).toBeVisible();
  await expect(row('Working')).toHaveAttribute('title', /Claude CLI/);
  // The permission dialog is not in the transcript. Only the process status shows it.
  await lights.claudeProcess(process.pid, 'waiting', 'dialog open');
  await expect(row('Needs you')).toBeVisible();
  await lights.claudeProcess(process.pid, 'idle');
  await expect(row('Idle')).toBeVisible();
  await lights.claudeProcess(process.pid, 'busy');
  await expect(row('Working')).toBeVisible();
  // Claude removes its status file on a normal exit. A crash leaves the file behind.
  // The process is gone either way, so the transcript decides.
  await lights.removeClaudeProcess(process.pid);
  const finished = require('node:child_process').spawn(process.execPath, ['-e', '']);
  await new Promise(resolve => finished.once('exit', resolve));
  await lights.claudeRecord({ type: 'assistant', entrypoint, message: { content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn' } });
  await lights.claudeProcess(finished.pid, 'waiting', 'dialog open');
  await expect(row('Idle')).toBeVisible();
});

test('a status file left by a crashed Claude process does not keep a quiet session working', async ({ lights }) => {
  // The system can give the crashed process number to another program. This test uses a live process number.
  const threeHoursAgo = Date.now() - 3 * 3600_000;
  await lights.claudeRecord({ type: 'user', entrypoint: 'cli', timestamp: new Date(threeHoursAgo).toISOString(), message: { content: 'Run the migration' } });
  await lights.claudeProcess(process.pid, 'busy', undefined, lights.ids.claude, threeHoursAgo);
  await lights.expand();
  const row = state => lights.page.getByRole('button', { name: `Run the migration: ${state}`, exact: true });
  await expect(row('Unknown')).toBeVisible();
  await expect(row('Working')).toHaveCount(0);
  // The same process reports fresh work. Now the file counts.
  await lights.claudeProcess(process.pid, 'busy');
  await expect(row('Working')).toBeVisible();
});
