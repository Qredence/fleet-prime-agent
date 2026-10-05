---
"@qredence/fleet": patch
---

Pin the stock Prime Agent runtime at 0.9.8 (from 0.9.3), together with the matching `prime-agent-core` / `prime-agent-ai` family tarballs. The daemon protocol identity is unchanged (`prime-agent.daemon@7`; schema revision 26 → 30 is additive) and the public `prime-agent` export surface is unchanged, so no daemon adapter changes were required. Fleet adaptations for upstream behavior changes since 0.9.3:

- Subagent rows and the subagent thread header now show the child's latest `rlm.progress.note` (`progressNote`), and RLM child records carry `activityStaleMs`.
- Composer ghost-text completion no longer harvests runtime-injected `[autonomous-continuation]`-style user-channel messages (0.9.5 bracket grammar) as human prompts.
- The `/autonomous` command hint now lists the budget flags (`--max-continuations`, `--max-turns`, `--max-tokens`, `--timeout-ms`, `--gate`) that upstream accepts, and `/scoped-models` names the real Alt+M cycling key.

Explicit reviewed reason for the under-7-day minimum-release-age window (v0.9.8 published 2026-09-29): user-directed runtime upgrade to pick up 0.9.4–0.9.8 daemon reliability, retry/quota, and Codex model-discovery fixes; the release-family tarballs are checksum-pinned via `PRIME_AGENT_RUNTIME.json`.
