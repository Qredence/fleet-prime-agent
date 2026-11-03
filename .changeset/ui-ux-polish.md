---
"@qredence/fleet": patch
---

Polish small chat and sidebar rough edges

- A tool you stop mid-run now shows "Cancelled" instead of "Failed".
- Enter submits the rename dialogs for sessions and projects.
- Untitled sessions show "New chat" in the sidebar instead of a raw session-id prefix.
- A subagent thread keeps one replay cursor across session resets, so a reset reloads it instead of replaying a stale stream.
