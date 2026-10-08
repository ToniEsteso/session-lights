# UX proposal

This proposal was implemented, then partly replaced. It improves the main task:
find a local session, see its last recorded state, and open it.

Later change: search, the Attention filter, and two-line rows were removed to keep
the panel compact. The list now shows the last 24 hours plus pinned sessions, puts
waiting and failed sessions first, and moves project, source, and model into the
row tooltip. See the README for current behavior.

## Findings and changes

| Finding | Change | User benefit |
| --- | --- | --- |
| A small colored dot is the only visible state label. | Show Needs you, Working, Idle, Failed, or Unknown on each expanded row. | Read the state without learning a color key. |
| A long list requires manual scanning. | Search titles, projects, workspaces, sources, models, and states. | Find a session without changing its saved order. |
| Urgent sessions are mixed with other sessions. | Add a Needs attention filter and live count for waiting and failed turns. | Find sessions that need action. |
| Hide requires a second view to reverse. | Show a named confirmation and Undo after a successful hide. | Restore the last hidden session and keep its pin. |
| Empty states offer little guidance. | Explain missing records, hidden sessions, and searches with no matches. Add Show all sessions for filtered empty states. | Give the user a clear next action. |
| Some settings help is available only to screen readers. | Show source behavior, state meanings, and update details. | Explain effects and failures in the panel. |
| Dense rows and 9–12 px text make the panel hard to read. | Use the Windows desktop type ramp: 14 px main text, 12 px supporting text, a 360 px expanded panel, and 72 px rows that can grow. Follow system display and text scaling. | Make text readable and reduce crowded text and accidental clicks. |

Ctrl+F or Cmd+F focuses search in the expanded thread list. Escape clears search
and the attention filter first. A second Escape closes the panel. Clear and
Show all sessions return focus to search. Undo returns focus to the restored
session. Filters are temporary and apply only to the expanded list.

The compact bar, adapter reads, chat handoff, saved pins, hiding, sort order,
themes, and reduced motion keep their existing behavior. The app still reports
the last recorded state. It does not claim a direct live connection to a provider.

## Design guidance

- [Microsoft: Typography in Windows](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/typography): use 14/20 body text and 12/16 captions in effective pixels. System scaling handles display density.

- [NN/g: 10 usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/): visible status, recognition, user control, and clear recovery.
- [W3C: Use of color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html): provide another visible way to read meaning.
- [W3C: Focus visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html): make keyboard focus clear.
- [W3C: Target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html): provide adequate target size or spacing.

These sources guide the choices. This review is not a full accessibility audit
or a claim of WCAG conformance. The compact lights retain the small footprint
of the original desktop utility. A Mac check is still needed for native behavior
and Cmd+F.

## Checks

The three new Electron scenarios specify starting state, action, and required
result in `tests/e2e/ux.spec.cjs`. They check observable behavior through the app.
They can remain valid if internal code changes without a behavior change.
The full suite also checks existing provider states, saved settings, sorting,
chat handoff errors, animation anchoring, and long model names.

Current run results, environment limits, screenshots, and the browser video
are recorded in the task's `.evidence/demos/` folder. Earlier verification files
are history and do not prove this checkout.
