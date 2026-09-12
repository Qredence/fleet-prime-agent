# Changelog

## 0.6.1

### Patch Changes

- 32da53c: Fix clipped right-panel tabs, low-contrast chrome menus, header New chat, and hung workspace Markdown previews.
- ada7fde: Restore the source-checkout `fleet-prime.sh` launcher, replace an existing `fleet-agent` symlink instead of writing through it, and keep the web launcher running if an SSR stream times out.

## 0.6.0

### Minor Changes

- 6889089: Edit queued steering and follow-up messages in place from the Fleet web UI, with the same expected-text guards and queue synchronization as deletion. Empty edits delete; otherwise the message is replaced via the queue PATCH seam.
- 3299983: Keep slash commands with arguments in the composer until submit, title command-only sessions from Fleet sidecars instead of "(no messages)", and add a Settings MCP connections surface with browser-safe list, add, login, and logout.

## 0.5.11

### Patch Changes

- 786027b: React health triage, streaming correctness and trust-boundary hardening, design hygiene, and measured perf fixes across the Fleet Prime web app.
- 786027b: Improve chat-workspace reliability, loading performance, and project safety:
  
  - Keep verified uploaded raster images renderable in previews while preserving forced downloads for other attachments.
  - Defer Settings and Fork dialogs until they are first opened, so their lazy chunks stay off the cold-load path.
  - Preserve staged attachments when direct or queued sends fail, and reconcile duplicate streamed question frames so answered questions close correctly.
  - Ignore stale session-resume failures before recovery can replace a newer session.
  - Prevent projects from targeting GitHub CLI credential directories, including relocated XDG configuration paths.
  - Keep existing settings with more than 100 resource entries readable while enforcing bounded update requests.
  - Allow JSONL exports to create nested directories within the active project without weakening path confinement.

## 0.5.10

### Patch Changes

- bfb0429: Improve Fleet Prime development startup, orb setup, and UI responsiveness with faster Vite loading and more stable chat controls.

## 0.5.9

### Patch Changes

- 280ba1b: Make the generated bundle-budget release metadata deterministic so immutable npm release retries produce the same artifact checksum.

## 0.5.8

### Patch Changes

- 244d1dc: Replace the tab icon with the new Qredence brand marks: themed SVG favicons (white mark on dark schemes, black mark on light schemes) plus a regenerated multi-size ICO fallback. Tracks the canonical brand sources under assets/brand and refreshes the public logo copies.
- 244d1dc: Show the released Fleet package version as a badge in the session sidebar footer, baked in at build time from the launcher manifest.
- 244d1dc: Fall back to the first available model of a known provider when the requested model id no longer resolves (e.g. a stale persisted default after an upstream catalog change) instead of failing the turn. Unknown providers still error. Also fixes the standalone browser-smoke bundling check to resolve workspace runtime packages.
- 244d1dc: Pin the stock Prime Agent runtime at 0.9.3 (daemon macOS-timezone creation fix, Codex model discovery fix, usage/summary additions). The daemon protocol identity is unchanged and all API deltas are additive, so no adapter changes were required. Also surfaces the upstream kernel stderr tail in the Repl panel as session kernel diagnostics.
  
  Explicit reviewed reason for the under-7-day minimum-release-age override (v0.9.3 released Sep 6): user-directed upgrade for daemon reliability and catalog freshness. Note: 0.9.3 does not send x-opencode-session, so OpenCode Go models remain gateway-rejected until an upstream release adds session-header support.
- 244d1dc: Revamp the Settings dialog around the fixed xl canvas pattern: fixed-height dialog with a grouped section sidebar (Workspace, Models, Advanced), visible sidebar title, narrower sidebar rail, and a section Select on small screens replacing the tab strip. Removes the now-unused DiscreteTabs primitive.
- 244d1dc: Subagent tabs gain a pinned composer so a child thread can be messaged directly, mirroring how the upstream agents view attaches to any agent row for an interactive turn. `POST /api/chat` accepts an optional `childId` alongside the parent `sessionId` (text-only turns with steer admission); the turn runs on a borrowed per-turn connection that is disposed on settle, with live frames carried by the existing child watcher stream and abort via `POST /api/chat/abort`.
- 244d1dc: Refresh patch/minor dependencies (Biome 2.5.11, Zod 4.5.4, TanStack Query, lucide-react, shadcn, streamdown, OpenUI libs) and add protocol contract tests. Regenerate the OpenUI contract for the updated schema emitter (equivalent `type: ["string", "number"]` shape). Keep happy-dom pinned at 20.11.6: 20.12.0 throws unhandled AbortErrors from Animation.cancel under motion-dom and fails `test:web`.

## 0.5.7

### Patch Changes

- 02b9353: Refactors chat session bootstrap and live event handling, improves scoped agent-tab state and chat activity surfaces, and coalesces repeated child-session refreshes.

## 0.5.6

### Patch Changes

- ddeafb1: Shrinks the welcome-route eager JavaScript bundle (~7%) by lazy-loading chat panels, timelines, and pickers behind skeleton fallbacks, isolates composer keystrokes from transcript re-renders, and adds zero-dependency LCP/INP/CLS telemetry plus a bundle-budget snapshot for CI.

## 0.5.5

### Patch Changes

- 6f6db1c: Adds first-class read-only subagent conversation tabs with resilient live and snapshot transcript handling.
- 2a1e883: adding changeset

## 0.5.1

### Patch Changes

- 66cc436: Align the checked-in package version with the existing npm release baseline
  and establish the automated Changesets release flow.

All notable changes to `@qredence/fleet` are recorded here by Changesets.

## 0.5.0

Existing npm baseline before the repository-managed release workflow.
