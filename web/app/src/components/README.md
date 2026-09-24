# Component areas map

The Fleet Prime web application owns its UI source. Components live under
`web/app/src/components/`, grouped by product area, and are imported through
the application's `@/*` alias.

## Layer rules

```text
ui/        → Fleet-styled controls, compound parts, reusable UI compositions, and adapters
openui/    → generative UI surfaces built on the shared UI layer
<areas>/   → product composition; compose shared UI via @/components/ui/*
motion/    → motion-only helpers (no parallel Select/Combobox/Popover/Checkbox/Radio/Input)
```

- Import shared components from their exact `@/components/ui/<file>` path; do **not** relative-import into `ui/` or add a catch-all barrel.
- Keep behavior and styling composable: use named parts for compound controls, explicit props for complete controls, and only expose `render`/`asChild` where its element/ref semantics are tested.
- Preserve the distinction between low-level design-system controls and higher-level compositions/adapters. Settings-specific rows belong to `settings/`; Recharts wrappers may remain in `ui/` as documented adapters; the responsive Fleet sidebar is a shell element, not a generic primitive.
- New `@beui` installs that are interactive controls belong in `ui/`; motion-only chrome stays in `motion/`. Do **not** add parallel form/overlay controls under `motion/` or product areas.
- `openui/` composes the shared UI layer for generated surfaces; product areas should not reimplement shared controls.
- Put behavior tests beside the owning UI component. Test accessibility, interaction, state, and composition contracts rather than utility-class strings or broad snapshots.

```text
components/
  ui/          # Base UI wrappers, Fleet-styled controls, compound components, adapters
  settings/    # Settings-specific rows and settings compositions
  openui/      # generative UI library, renderers, artifact shell
  layout/      # app chrome: sidebar shell, header, right-panel shell/registry, chrome tokens
  chat/        # chat surface, session lifecycle, composer, transcript, plans, subagents
  sessions/    # session sidebar, agent tabs, session tree/insights, thread search
  workspace/   # workspace file tree/preview, resources, repl, right-panel launcher
  artifacts/   # session artifact runs and panels
  settings/    # settings dialog, sections, provider credentials, MCP connections
  tools/       # tool renderers + registry (left mostly flat)
  motion/      # motion-only helpers (action-swap, file-tree, preview-rail, runtime, shared-layout-bg)
```

## Rules

1. Each product area owns its UI, local hooks, query/mutation definitions, pure
   helpers, and tests.
2. Cross-area imports use an area's intentional entry component or hook rather
   than another area's private implementation.
3. `components/layout` composes areas and coordinates genuinely cross-area
   actions; it is not a general-purpose state hook.
4. `src/hooks/` and `src/lib/` hold cross-area capabilities only.
5. Wire contracts stay in `@prime-agent/web-protocol`; browser code never
   imports the Prime Agent runtime.

`web/app/scripts/component-contract-check.ts` enforces the mechanical parts of
these rules (one name one home, no dead files, primitive boundaries).

## Intentional deviations

- `chat/agent-chat.tsx` stays at the chat root (central surface, high import fan-out).
- `model-selector*`, `fork-picker-dialog`, `chat-welcome*`, `types.ts`, `icons.tsx`
  stay at the chat root.
- `tools/` is not re-grouped into `tools/core/` (subtractive preference).
