---
"@qredence/fleet": patch
---

Reject session commands, resume requests, and other session-scoped operations when their project is no longer registered, including sessions already open in Fleet. Resource discovery no longer reads runtime snapshots from inaccessible sessions. Require request-aware origin guarding for API handlers while preserving existing local-client access.
