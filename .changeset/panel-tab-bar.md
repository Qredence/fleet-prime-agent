---
"@qredence/fleet": patch
---

Share one tab strip between agent conversations and the side panel

The agent conversation tabs, the right-panel launcher, and the in-panel view
switcher were separate implementations of the same strip. All three now render
the shared `TabStrip` on the existing `ui/tabs` primitive, so keyboard roving
comes from Base UI instead of hand-written handlers. The proximity-hover pill
is gone, and right-panel tabs keep their labels visible instead of collapsing
inactive tabs to an icon.
