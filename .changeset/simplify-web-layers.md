---
"@qredence/fleet": patch
---

Simplify the browser-to-runtime layer: derive wire types from Zod schemas, share the session response between session load and resume, drop the unused OpenUI syntax negotiation, and normalize tool rendering in one place. No wire contract change for existing clients.
