---
"@qredence/fleet": minor
---

Edit Prime Agent settings and provider credentials from Fleet instead of being told to go to the terminal.

Settings and provider credentials are written to the files Prime Agent reads, using a locked atomic write that never leaves a half-written file and keeps credential files owner-only. Settings that Fleet does not model survive a save, grouped settings such as retry merge field by field, and a file Fleet cannot parse is left untouched rather than replaced. Saving a resource setting reloads the runtime; changing model routing takes effect on the next session.

Providers that only had a stored credential, with no entry in the engine catalog, were missing from Settings entirely and could not be reviewed or removed. They now appear, while MCP connections stay out of the provider list.
