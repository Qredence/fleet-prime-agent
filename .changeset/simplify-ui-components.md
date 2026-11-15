---
"@qredence/fleet": patch
---

Tightened the web UI component library and unified corner radii.

- Controls now follow the documented concentric radius ladder: chips, buttons, inputs and list rows use the 8px inner step, cards and dialogs the 16px shell step, while the composer keeps its 24px surface. This removes the accidental pill-shaped look on standard controls, along with the unused "pill" shape variant behind it.
- The model and mode selector in the composer no longer stretches to full pill width: it stays compact, truncates long model names, and shows the full name on hover.
- The reasoning-effort slider in the model picker no longer shows its label and value on background-colored patches that clash with the popover surface; the text now sits seamlessly on the popover while still covering the step dots behind it.
- Status chips (tool approvals, project dialogs, image generation) now use the shared Badge, and error boxes use the shared Alert, so colors, spacing and radii stay consistent everywhere.
- Loading spinners now respect the reduced-motion preference.
- Removed large amounts of dead UI code (unused card, breadcrumb, tabs, select, table, dialog and slider variants), shrinking the app bundle and making the primitives faster to load.
