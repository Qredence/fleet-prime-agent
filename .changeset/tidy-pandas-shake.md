---
"@qredence/fleet": patch
---

Shrinks the welcome-route eager JavaScript bundle (~7%) by lazy-loading chat panels, timelines, and pickers behind skeleton fallbacks, isolates composer keystrokes from transcript re-renders, and adds zero-dependency LCP/INP/CLS telemetry plus a bundle-budget snapshot for CI.
