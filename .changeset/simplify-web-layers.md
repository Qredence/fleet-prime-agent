---
"@qredence/fleet": patch
---

Simplify the browser-to-runtime layer: derive wire types from Zod schemas, share the session response between session load and resume, drop the unused OpenUI syntax negotiation, and normalize tool rendering in one place. `openUISyntaxVersion` is no longer read: every OpenUI turn now receives the current-catalog prompt, including callers that previously received the legacy prompt by default. `ChatToolPart.error` is no longer schema-validated as an error envelope.
