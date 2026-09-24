---
"@qredence/fleet": minor
---

Redesigned control primitives and sidebar. Buttons move to a two-step size ladder (36px default / 28px compact, with legacy `sm`/`md`/`lg` values still accepted) with a press-collapse surface effect and loading spinners; scroll areas gain shape-system scrollbars with a native fallback on touch-primary devices; a new sidebar system adds fluid hover highlights, drag-resize with collapse-on-throw, peek overlays, and keyboard shortcuts (`[` / `]`). Sidebar rename/delete/fork dialogs share one unified dialog state, and resource panels are keyboard-resizable via a WAI-ARIA separator.
