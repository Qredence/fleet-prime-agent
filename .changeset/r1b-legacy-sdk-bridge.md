---
"@qredence/fleet": patch
---

Route Fleet's remaining Prime Agent v0.9.8 SDK config and transcript access through one temporary legacy bridge, read session transcripts without ever rewriting them, and drop Fleet's duplicate IPython kernel prewarm (the runtime provisions its own kernel). `GET /api/health` no longer reports `kernel`.
