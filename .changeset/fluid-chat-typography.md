---
"@qredence/fleet": patch
---

Chat replies now use Fluid Functionalism typography, with consistent headings, lists, tables, and code styling. Prose follows the interface density preference, using a smaller scale and tighter spacing in compact mode while keeping embedded code controls independent.

The composer Agent and model/reasoning selectors also follow Fluid's body type scale at the active interface density.

Simplified the model picker to name-only rows, removed model icons, and made composer attachment and slash-command actions ghost buttons. Long model names truncate to keep the composer controls accessible on narrow screens, with the full name available on hover.

Composer command suggestions now use compact, single-line rows with inline descriptions and quieter group labels.

The chat surface behind the composer is transparent; the composer retains its own filled background.

Messages now scroll behind the filled composer, with transparent surroundings and bottom clearance that follows the composer height.
