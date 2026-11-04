---
"@qredence/fleet": patch
---

Polish small chat and sidebar rough edges

- A tool you stop mid-run now shows "Cancelled" instead of "Failed".
- Enter submits the rename dialogs for sessions and projects.
- Untitled sessions show "New chat" in the sidebar instead of a raw session-id prefix.
- A subagent thread keeps one replay cursor across session resets, so a reset reloads it instead of replaying a stale stream.
- Clicking a side-panel tab switches to it instead of closing the panel.
- On narrow screens the panel launcher switches to its dropdown when its tabs don't fit, and the New chat button no longer overlaps it.
- On phones the Main and Activity header tabs show just their icons, with the name in a tooltip, instead of cut-off labels.
