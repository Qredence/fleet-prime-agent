---
"@qredence/fleet": patch
---

Reclaim idle Fleet connections and cap replay payloads while preserving active work and saved conversations. Reopening a detached session hydrates its saved messages and presentation; replay gaps trigger recovery instead of retaining oversized frames.
