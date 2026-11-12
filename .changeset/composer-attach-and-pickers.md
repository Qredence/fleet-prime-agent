---
"@qredence/fleet": patch
---

The composer has an attach control again. The composer's `+` menu was reachable but the file-attachment button had been dropped from the toolbar, so the plumbed-through attach action could not be triggered from the UI. A paperclip button now sits beside `+`, opens the same attach flow, and is disabled while a turn is running. Attached images render as design-system attachment chips, so they are slightly smaller than the previous 64px tiles.

Composer pickers select the same way every other dialog does. The mode, model, and effort pickers are now built on the shared popover and radio-group primitives, which means the trigger correctly announces itself as opening a dialog, arrow keys move through the mode list and update the selection, and the popup closes on the standard outside press and Escape. Previously the model picker announced itself as a combobox over a dialog, and the mode picker required Home and End to jump between options.

No change to what the composer sends, how drafts are kept, or how ghost text behaves.
