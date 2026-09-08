---
"@qredence/fleet": patch
---

Subagent tabs gain a pinned composer so a child thread can be messaged directly, mirroring how the upstream agents view attaches to any agent row for an interactive turn. `POST /api/chat` accepts an optional `childId` alongside the parent `sessionId` (text-only turns with steer admission); the turn runs on a borrowed per-turn connection that is disposed on settle, with live frames carried by the existing child watcher stream and abort via `POST /api/chat/abort`.
