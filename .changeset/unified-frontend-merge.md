---
"@qredence/fleet": patch
---

Consolidate the web frontend into one application package. The design-system sources, styles, hooks, tests, and checks that used to live in a separate private workspace package now live in `web/app`, and the packaged server bundle resolves its remaining dependencies from their ESM entry points. Nothing changes in the interface: the chat surface, right panels, settings, and tools behave as before, and no action is needed when upgrading.
