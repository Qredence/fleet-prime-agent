---
"@qredence/fleet": patch
---

`openUISyntaxVersion` is gone. Every OpenUI turn receives the current-catalog prompt, including callers that previously received the legacy prompt by default. A request that still sends `openUISyntaxVersion` is rejected.

`ChatToolPart.error` is no longer validated as an error envelope. The server still sends an envelope.

A presentation saved while the previous write was finishing is now persisted. That save could previously be acknowledged and then dropped. A Thinking or Fleet reasoning part is no longer shown as a nested tool trace. A failed composer-intent save reports the HTTP error instead of quietly reverting the Settings toggle. Provider, MCP, and full model-catalog requests wait until Settings is opened.
