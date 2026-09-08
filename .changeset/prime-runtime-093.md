---
"@qredence/fleet": patch
---

Pin the stock Prime Agent runtime at 0.9.3 (daemon macOS-timezone creation fix, Codex model discovery fix, usage/summary additions). The daemon protocol identity is unchanged and all API deltas are additive, so no adapter changes were required. Also surfaces the upstream kernel stderr tail in the Repl panel as session kernel diagnostics.

Explicit reviewed reason for the under-7-day minimum-release-age override (v0.9.3 released Sep 6): user-directed upgrade for daemon reliability and catalog freshness. Note: 0.9.3 does not send x-opencode-session, so OpenCode Go models remain gateway-rejected until an upstream release adds session-header support.
