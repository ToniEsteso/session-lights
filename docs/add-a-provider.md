# Add a provider

1. Add a TypeScript module under `src/adapters/`.
2. Implement `SessionAdapter`. Use a unique provider `id`.
3. Parse your provider's external data before returning it.
4. Add the adapter to `createAdapters()` in `src/adapters/index.ts`.
5. Run `pnpm run check` and `pnpm run build`.
6. Verify the provider's session states, usage, and chat opening through the running app.

The following adapter shows the required contract and the optional usage and opening capabilities.

```ts
import type { OpenExternal, SessionAdapter, SessionReading, UsageDefinition, UsageReading } from '../shared/contracts.js';
import { epochMilliseconds, unixSeconds } from '../shared/time.js';

export class ExampleAdapter implements SessionAdapter {
	readonly id = 'example';
	readonly name = 'Example';
	readonly usage: UsageDefinition = {
		scope: 'Workspace usage',
		windows: [{ id: 'daily', label: 'Daily', title: 'Daily allowance' }]
	};

	async read(): Promise<SessionReading> {
		return {
			health: 'Sample data.',
			sessions: [{
				id: 'chat-1', title: 'Example chat', project: 'Example project',
				projectId: 'example:project-1', state: 'idle', detail: 'Finished.',
				updatedAt: epochMilliseconds(1791187200000) // Last activity from the provider record.
			}]
		};
	}

	async readUsage(): Promise<UsageReading> {
		return {
			windows: [{ id: 'daily', remainingPercent: 72,
				resetsAt: unixSeconds(Math.floor(Date.now() / 1000) + 3600) }],
			updatedAt: epochMilliseconds(Date.now())
		};
	}

	async open(id: string, openExternal: OpenExternal): Promise<void> {
		if (!/^chat-\d+$/.test(id)) throw Error('Invalid Example chat ID.');
		await openExternal(`example://chats/${id}`);
	}
}
```

Every session must supply `updatedAt` in epoch milliseconds. Use the provider's last recorded session activity, not the time of `read()`. Keep it unchanged until new activity occurs. Use `epochMilliseconds(0)` when unavailable. The panel uses it for activity sorting, the age on the right side of each expanded row, and session tooltips.

Omit `readUsage()` when your provider has no limits. Omit `resetsAt` when the provider supplies no reset time.
Return an empty `windows` array and `updatedAt: null` when usage is unavailable.
Define known windows in `usage` if their labels must remain visible during failed reads.

Omit `open()` when chat links are unavailable.
Add `close()` when the adapter owns a child process or another resource that needs cleanup.

Use one adapter for each provider. If one provider has multiple interfaces, set
the optional session `source` label, such as `CLI` or `Desktop`. The panel shows
it beside the provider name. The adapter keeps interface-specific reading and
opening rules. The provider still has one Settings switch and one usage reader.

Use a shared `projectId` only when providers refer to the same project.
Prefix a provider-local project ID with the provider ID.
See the [README project rules](../README.md#extend) for workspace normalization and grouping.

For each future test, name a feature failure that it detects.
Use public adapter or `SessionMonitor` methods with small external data fixtures.
Check observable session states, project grouping, usage, and failure recovery where applicable.
Follow the [test rules](../AGENTS.md#test-feature-behavior). The previous extension tests have been removed.
