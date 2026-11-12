---
"@qredence/fleet": patch
---

Simplify the chat composer around shared input and attachment controls while preserving commands, workspace references, inline suggestions, model selection, and streaming actions.

Keep composer actions consistently sized and the send icon legible in both themes.

Keep keyboard command selection aligned with grouped menus, honor disabled suggestions, and allow the model picker to open without externally controlled state.

Discard cancelled intent responses so disabling routing cannot restore an old cached execution decision.
