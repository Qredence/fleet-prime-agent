---
"@qredence/fleet": patch
---

Correct the MCP and provider sign-in guidance

Fleet cannot start OAuth sign-in itself: the pinned daemon exposes no login command,
and the only entry point is Prime Agent's interactive terminal. The previous guidance
told users to "launch Prime Agent in a terminal and complete sign-in", which fails —
the CLI `mcp` subcommand has no `login`, only `add|list|get|remove`.

The alerts and the 501 responses now name the commands that exist (`/mcp login <name>`
for MCP servers, `/login` for providers) and no longer claim a Fleet restart is needed.
Restarting Fleet cannot reload the credential in any case: the daemon is spawned
detached and re-attaches to an already-running socket, and it re-reads `auth.json` on
each call.
