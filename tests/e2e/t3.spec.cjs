const { test, expect } = require('./fixtures.cjs');

const rows = page => page.getByRole('list', { name: 'Sessions', exact: true }).getByRole('listitem');

// T3 Code starts Codex and Claude Code itself. The panel must list those threads whether T3 is installed or not.
test('threads that T3 Code started appear without any T3 data and open in T3 Code', async ({ lights }) => {
  await lights.codexT3Thread(lights.ids.codexT3, 'Plan the release', 'task_started');
  await lights.claudeRecord({ type: 'user', entrypoint: 'sdk-ts', message: { content: 'Write the changelog' } }, lights.ids.claudeT3);
  await lights.expand();
  const page = lights.page;
  const codex = page.getByRole('button', { name: 'Plan the release: Working', exact: true });
  await expect(codex).toHaveAttribute('title', /Codex T3 Code/);
  await expect(page.getByRole('button', { name: 'Write the changelog: Working', exact: true })).toHaveAttribute('title', /Claude SDK/);
  // The thread runs in T3. A Codex desktop link or a terminal would open the wrong program.
  await codex.click();
  await expect.poll(() => lights.openedChats()).toEqual(['t3code://app/']);
  await expect(page.getByRole('alert')).toBeHidden();
  await lights.setOpenFailure(true);
  await codex.click();
  await expect(page.getByRole('alert')).toContainText('Cannot open T3 Code. Check that the desktop app is installed.');
});

// Without T3 data, an Agent SDK session can come from any host. With T3 data, it is a T3 thread.
test('a Claude thread opens in T3 Code only when T3 lists it', async ({ lights }) => {
  const { claudeT3 } = lights.ids;
  await lights.claudeRecord({ type: 'user', entrypoint: 'sdk-ts', message: { content: 'Write the changelog' } }, claudeT3);
  await lights.expand();
  const page = lights.page;
  // The terminal path runs. No Claude Code is installed in the fixture, so it reports that.
  await page.getByRole('button', { name: 'Write the changelog: Working', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Claude Code not found.');
  expect(await lights.openedChats()).toEqual([]);
  await lights.t3Database([{ provider: 'claudeAgent', sessionId: claudeT3, title: 'Write the changelog', project: 'atlas',
    projectRoot: require('node:path').join(require('node:os').tmpdir(), 'atlas') }]);
  const thread = page.getByRole('button', { name: /^Write the changelog: / });
  await expect(thread).toHaveAttribute('title', /Claude T3 Code/);
  await thread.click();
  await expect.poll(() => lights.openedChats()).toEqual(['t3code://app/']);
});

test('T3 data names threads, groups worktrees by project, and shows approvals while T3 runs', async ({ lights }) => {
  const { codexT3, claudeT3, claude } = lights.ids;
  await lights.codexT3Thread(codexT3, 'first prompt of the codex thread');
  await lights.claudeRecord({ type: 'user', entrypoint: 'sdk-ts', message: { content: 'first prompt of the claude thread' } }, claudeT3);
  await lights.claudeRecord({ type: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn' } }, claudeT3);
  // Another Claude session in the project's main folder. T3's worktrees must group with it.
  const projectRoot = require('node:path').join(require('node:os').tmpdir(), 'atlas');
  await lights.claudeRecord({ type: 'user', cwd: projectRoot, message: { content: 'Edit the readme' } }, claude);
  await lights.claudeRecord({ type: 'custom-title', cwd: projectRoot, customTitle: 'Edit the readme' }, claude);
  const threads = (extra = {}) => [
    { provider: 'codex', sessionId: codexT3, title: 'Plan the release', project: 'atlas', projectRoot, ...extra.codex },
    { provider: 'claudeAgent', sessionId: claudeT3, title: 'Write the changelog', project: 'atlas', projectRoot, ...extra.claude },
  ];
  await lights.t3Database(threads());
  await lights.expand();
  const page = lights.page;
  await expect(page.getByRole('button', { name: 'Plan the release: Idle', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Write the changelog: Idle', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /first prompt/ })).toHaveCount(0);
  // An approval and a question exist only in T3's database while T3 runs.
  await lights.t3Database(threads({ codex: { approvals: 1 }, claude: { questions: 1 } }));
  await expect(page.getByRole('button', { name: 'Plan the release: Needs you', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Write the changelog: Needs you', exact: true })).toBeVisible();
  // A running T3 turn shows as working even before the provider writes a record.
  await lights.t3Database(threads({ codex: { status: 'running' } }));
  await expect(page.getByRole('button', { name: 'Plan the release: Working', exact: true })).toBeVisible();
  // After T3 closes, its counts are stale. The provider records decide again.
  await lights.t3Database(threads({ codex: { approvals: 1, status: 'running' }, claude: { questions: 1 } }), { running: false });
  await expect(page.getByRole('button', { name: 'Plan the release: Idle', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Write the changelog: Idle', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Group by project', exact: true }).click();
  await expect(rows(page)).toHaveCount(6);
  await expect(page.getByText('atlas', { exact: true })).toHaveCount(1);
  // A thread deleted in T3 leaves the panel.
  await lights.t3Database(threads({ claude: { deleted: true } }), { running: false });
  await expect(page.getByRole('button', { name: /Write the changelog/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Plan the release: Idle', exact: true })).toBeVisible();
  // A settled thread is finished work. T3 lists it as done, so the panel hides it as if deleted.
  await lights.t3Database(threads({ claude: { settled: true }, codex: { settled: true } }), { running: false });
  await expect(page.getByRole('button', { name: /Plan the release|Write the changelog/ })).toHaveCount(0);
  await expect(rows(page)).toHaveCount(4);
  // New activity makes T3 unsettle a thread. A settled thread that still runs or waits stays visible.
  await lights.t3Database(threads({ claude: { settled: true, questions: 1 }, codex: { settled: true, status: 'running' } }));
  await expect(page.getByRole('button', { name: 'Write the changelog: Needs you', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Plan the release: Working', exact: true })).toBeVisible();
  await lights.t3Database(threads());
  await expect(page.getByRole('button', { name: 'Plan the release: Idle', exact: true })).toBeVisible();
});
