# React Doctor intentional architecture exceptions

This document records deliberately retained architecture trade-offs. Unlike
[false-positives.md](./false-positives.md), these are not detector errors. The
corresponding narrow scanner overrides are in `doctor.config.jsonc`.

## 1. WorkspacePanel selected-path reconciliation

`WorkspacePanelContent` intentionally supports both controlled and uncontrolled
selection. In controlled mode, `web/app` owns the selected path so assistant
and file-navigation actions can coordinate the workspace and artifacts panels.
After a workspace refresh, the selection effect clears a path that is no longer
present or falls outside the active scope, together with its preview and preview
error.

This is not a detector false positive. Moving this ownership requires a
purposeful parent-state redesign that changes the workspace tree source and its
selection owner together. That work would also touch the currently user-modified
`web/app/src/routes/index.tsx`, so it is deliberately deferred.

**Re-evaluate:** when the selection owner and workspace tree source are
redesigned together.

## 2. Recharts/OpenUI synchronous module boundary

The custom OpenUI catalog imports its Recharts-backed components synchronously.
`scripts/openui-render-check.tsx` parses the catalog, statically renders it with
`renderToStaticMarkup`, then client-renders it in happy-dom to prove chart
geometry. React 19's static renderer cannot cross a suspending `React.lazy`
boundary, so replacing these imports with lazy imports would weaken the current
parser/static/client coverage unless the harness moved to a compatible streaming
SSR architecture.

This is an intentional static-render compatibility decision. Recharts is
reachable through the custom OpenUI chart catalog, and the existing client stage
continues to prove chart geometry.

**Re-evaluate:** if the harness moves to a streaming SSR API while preserving
equivalent parser, static, and client coverage.

## 3. Reserved future UI modules

The following side-effect-free modules form a coherent future authentication and
mode-selection surface and are retained by explicit user direction while OpenUI
is expanded alongside the current chat interface:

- `web/design/src/components/agent-elements/input/mode-selector.tsx`
- `web/design/src/components/fleet-pi/icons/google-icon.tsx`
- `web/design/src/components/fleet-pi/primitives/centered-loader.tsx`

**Re-evaluate:** when that integration either imports these modules or removes
the future surface intentionally.

## 4. Legacy message-turn component props

`UserTurn` and `AssistantTurn` remain exported through the package wildcard, so
existing consumers may still provide their former flat boolean props. The
components also accept the grouped `display`, `stream`, and `copy` objects used
by `MessageList`; both shapes normalize at the boundary before rendering.

This retains source compatibility without undoing the grouped internal contract.
The scanner warning is intentionally waived only for this compatibility adapter,
rather than silently breaking external TypeScript consumers in a minor release.

**Re-evaluate:** at the next documented major-version migration, when flat props
can be deprecated and removed with a published replacement guide.
