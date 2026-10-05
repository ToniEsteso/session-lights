# Next steps

Keep the compact bar clear. Put choices in the expanded panel or tray menu.
These are ideas, not implemented features.

## First choices

1. Keep lights in fixed positions. Activity changes currently change their order. Let the user move a light in the expanded list. Keep that order after restart.
2. Choose tracked chats. Hide and restore chats within Session Lights. Do not archive them in the source app. Let a project selection reduce a long list.
3. Add a shortcut to the next chat that needs input. Also add a shortcut to show or hide the panel. Let users change keys that another app already uses.
4. Keep known chats visible after a source read fails. Change them to gray. Show the age and source error in the tooltip. Restore their state after a good read.

## Quiet attention cues

- Optional alerts for a new question or failed turn. Alert once for a state change. Do not alert for every poll or every saved chat at startup.
- Optional usage alerts at chosen thresholds. Alert once per reset period. Use each adapter's scope so the alert does not imply a per-chat limit.
- A timed quiet mode in the tray. Keep monitoring while the panel and alerts are hidden.

## Daily use

- Remember a separate position for each monitor. Allow either screen edge. Check monitor removal and changes in display scale.
- Use a stable install folder before adding start at sign-in. Portable builds currently get a new folder on each build.
- Add a small settings view for startup, source selection, colors, alerts, and motion. Avoid extra controls in compact mode.
- Check tooltip placement, dragging, Spaces, full-screen apps, usage reads, and packaging on a Mac before a release.

## Providers

The adapter contract now covers sessions, opening chats, usage, and resource cleanup.
A second test provider checks different limit names, limits without a reset time, failures, and chat opening.

Choose the next real provider before adding more shared abstractions.
Confirm how it identifies active sessions, requests user input, reports limits, and opens an existing chat.
Support sessions even when that provider has no usage API.
Do not estimate account limits from token counts or treat a finished response as proof that background work stopped.
