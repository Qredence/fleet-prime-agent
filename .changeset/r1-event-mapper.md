---
"@qredence/fleet": patch
---

Map Prime Agent daemon socket frames onto the `ChatStreamEvent` contract in the web server, and read RLM child session headers read-only instead of opening them through the SDK session manager.
