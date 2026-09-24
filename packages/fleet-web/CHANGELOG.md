# Changelog

## 0.7.0

### Minor Changes

- aacd3b5: Redesigned control primitives and sidebar. Buttons move to a two-step size ladder (36px default / 28px compact, with legacy `sm`/`md`/`lg` values still accepted) with a press-collapse surface effect and loading spinners; scroll areas gain shape-system scrollbars with a native fallback on touch-primary devices; a new sidebar system adds fluid hover highlights, drag-resize with collapse-on-throw, peek overlays, and keyboard shortcuts (`[` / `]`). Sidebar rename/delete/fork dialogs share one unified dialog state, and resource panels are keyboard-resizable via a WAI-ARIA separator.

## 0.6.6

### Patch Changes

- 71b18a5: Consolidate the web frontend into one application package. The design-system sources, styles, hooks, tests, and checks that used to live in a separate private workspace package now live in `web/app`, and the packaged server bundle resolves its remaining dependencies from their ESM entry points. Nothing changes in the interface: the chat surface, right panels, settings, and tools behave as before, and no action is needed when upgrading.

## 0.6.5

### Patch Changes

- 7cad8f4: Make the composer's inline suggestion adaptive and session-aware. How much of a suggestion is offered now follows how far the matching prompts agree with each other: below 0.5 confidence nothing is shown, between 0.5 and 0.8 only the part every candidate agrees on, and at 0.8 or above the whole continuation — for prompts from the session you are typing in. Cross-session history never extends past the agreed prefix. Since a longer draft narrows the candidate set, a session-tier suggestion lengthens on its own as you type, and shortens when the field is contested instead of committing to a guess.
  
  Prompts from the session you are typing in win outright over the cross-session history, so a session's own vocabulary is preferred and a new session still behaves exactly as before, from the history.
  
  The suggestion corpus now covers your whole history. It used to be read from each session's *model context* — the branch leading to the current leaf, with everything before a compaction boundary replaced by its summary — and to skip sessions over 2 000 messages and anything past the 400 most recently touched. That read saw 522 prompts where the store holds 682: prompts you had written were missing from the very corpus meant to remember them, which is why a follow-up typed mid-conversation so often found nothing. Reading the session's entries instead recovers them. Rebuilds still skip marathon sessions (over 10 000 entries) so a pathological transcript cannot dominate the background build.
  
  The command chip is gone. A recognised command is now offered in the same inline suggestion as a **replacement** — Tab sets the composer to the command rather than running it, so nothing executes without a second, explicit Enter. Escape dismisses the ghost and, for execute-band matches, suppresses auto-run for that draft until you edit it. Tab still belongs to the slash-command and `@mention` menus first.

## 0.6.4

### Patch Changes

- 2ce0f1b: Compose qredence-ui onto shared ui controls, place the workspace tree beside the preview with safer right-panel sizing, and bump age-safe web design dependencies.
- fbce697: Add optional composer command routing. With a `TYPESAFE_API_KEY` set on the server and the new Settings → Chat toggle turned on, a message that is really describing a built-in command is recognised: read-only commands run on submit, and state-changing ones are offered as a dismissible chip. Anything else — including every failure mode, a disabled toggle, or a missing key — is sent to the agent exactly as before.
- d189496: Add ghost-text autocomplete to the chat composer. As you type, a dimmed completion from your own earlier prompts appears after the caret; Tab accepts it, Escape dismisses it. Tab still belongs to the slash-command and `@mention` menus first, and a completion is only ever offered when the caret is at the end of the draft, so accepting can never insert text somewhere you were not looking.
- 7135cc0: Add shadcn Typeset for chat markdown, migrate `cn` to `cn@0.3.0` (`createCn` with Fleet font-size groups), and reorganize `qredence-ui` into coherent chat/panels folders without changing public behavior.
- afd5b65: Polish Fleet UI layout tokens: 8px grid, 24px shell inset/radius, concentric 8/16/24 radii, and density padding on chat/panel/settings shells.

## 0.6.3

### Patch Changes

- 1fdc437: Add a Session Tree right panel with branch browsing, transcript highlighting, and rewind-from-history support backed by dedicated session-tree protocol handlers.

## 0.6.2

### Patch Changes

- 8091f12: Polish the composer controls: unify Agent and Model selector triggers, use shared button chrome, apply brand-blue focus and send accents, open slash commands from plus without inserting `/`, and dismiss trigger menus on outside click.
- 0fc2a5f: Absorb chat UI into first-party qredence-ui, drop legacy Fleet/Beui identifiers, tighten shared chat tokens, and isolate streaming work from the composer.
- 582b775: Remove unused POST /api/chat/model endpoint (internal cleanup; no user-facing behavior change).
- f158eda: Remove unused pi hooks and server bridge exports (internal cleanup; no user-facing behavior change).
- 1aba5a9: Remove unused workspace browse/root API endpoints and client method (internal cleanup; no user-facing behavior change).
- 1900684: Wire density, reduced-motion, and transcript-follow settings, collapse overlapping turn-progress UI, and align chat tokens with the Fleet theme.

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
