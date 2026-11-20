---
"@qredence/web": patch
"@prime-agent/web-server": patch
---

Consolidate chat helpers and check scripts, and replace the custom slider motion engine and table selection-merge animator with the shared range control and a simple selected-row style. Chat, OpenUI, and TypeSafe behavior is unchanged; the effort slider and table selection highlight are visually simpler. Stopping a turn keeps a single abort notice when the completed message already includes that error. Starting a new chat no longer leaves the empty composer showing Stop after the previous turn. A user message delivered by both the live stream and session replay stays one bubble.
