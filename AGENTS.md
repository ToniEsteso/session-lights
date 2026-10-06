# Project instructions

## Communication

- Use ASD-STE100 Simplified Technical English. Write short, clear sentences.
- Do not repeat the user's request.

## Test feature behavior

The previous test suite has been removed. Add future tests only for useful feature behavior.
Test count and code coverage are not goals.

- Start with a feature requirement or a reported defect. Name the wrong behavior that the test must detect.
- Describe the starting state, the user action or external input, and the expected result before writing the test.
- Derive the expected result from the requirement. Do not copy the implementation's logic into the test.
- Use a public interface. For panel features, use the running app. For provider behavior, use public adapter or monitor methods.
- Assert an observable result, such as a session state, visible message, opened chat, or saved preference after a restart.
- Test pure functions when their results express a feature rule. Do not test a helper only because the helper exists.
- Keep tests valid when internal code changes without a change in feature behavior.
- Use real local files, SQLite, IPC, and processes where practical. Keep fixtures small and isolate mutable data.
- Use controlled substitutes only at external boundaries that cannot run in the check environment. State what they cannot prove.
- Cover failure, recovery, and persistence when the feature requires them. Do not add redundant cases for coverage.
- For a defect fix, confirm that the test fails with the defect and passes with the fix when practical.
- Make failures identify the broken feature result. Use bounded waits for observable changes instead of fixed delays.

Reject tests that do any of the following:

- Search source text for symbols, branches, imports, CSS rules, or implementation patterns.
- Assert private state, internal call order, or mock call counts without a feature requirement.
- Check a value that the test itself assigned without exercising feature behavior.
- Check a mock response without exercising the real feature that uses that response.
- Compare output with the same function, algorithm, or constant that produced it.
- Assert only that code runs, an object exists, or a value has the declared type.
- Duplicate another test without detecting a different feature failure.

Before keeping a test, answer both questions:

1. Which incorrect feature result makes this test fail?
2. Can the code structure change while the same feature behavior still makes this test pass?

Delete or rewrite a test when either answer is unclear. Do not replace the removed suite with renamed smoke checks or source assertions.

## Verify changes

- Run `pnpm run check` and `pnpm run build` for source changes.
- Use these commands to check types and build output. They do not prove feature behavior.
- Check the affected feature through its public interface. Record the input, action, result, and environment limits.
- Do not report a removed, skipped, or empty test suite as a pass. Do not add a test command that succeeds without tests.
- Run native app checks one at a time because they share the desktop and keyboard focus.
- Keep personal Codex records and credentials out of fixtures and evidence.
- Keep previous verification reports as history. Do not treat their results as proof for the current checkout.

<!-- show-me:start -->
For coding requests such as "do this and show me", use the show-me skill at C:/Users/tonie/.agents/skills/show-me/SKILL.md. Complete the change, check its actual behavior, and return the finished result in this chat. For UI work, include a short browser video. Handle routine setup and verification yourself; ask only when truly blocked. Use chat and local project evidence by default.
<!-- show-me:end -->
