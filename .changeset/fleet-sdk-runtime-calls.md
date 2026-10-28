---
"@qredence/fleet": minor
---

Read MCP connections from the Prime Agent daemon, and stop calling the bundled SDK at runtime for provider and model metadata.

The MCP list now reflects whether a credential actually works, not merely whether one exists. Servers whose stored token had expired were previously shown as connected; those tokens are common, since OAuth refresh expires silently, so the pane could report a working integration that had not been usable for weeks. Fleet also now shows every server the runtime knows about, and marks which ones accept a pasted token.

Provider and thinking-level metadata come from Fleet's own catalog instead of the SDK's bundled model list, so the settings pane depends on the providers Fleet supports rather than on what that particular SDK build shipped.
