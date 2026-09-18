---
"@qredence/fleet": minor
---

Add ghost-text autocomplete to the chat composer. As you type, a dimmed completion from your own earlier prompts appears after the caret; Tab accepts it, Escape dismisses it. Tab still belongs to the slash-command and `@mention` menus first, and a completion is only ever offered when the caret is at the end of the draft, so accepting can never insert text somewhere you were not looking.
