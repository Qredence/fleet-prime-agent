# Component areas map

The Fleet Prime web application owns its UI source. React UI components live under `web/app/src/components/`, grouped by product area and imported through the `@/*` path alias.

## Architectural layers

```text
ui/        → @fluid Base UI primitives, AI Elements compositions, and adapters
openui/    → generative UI component catalog and renderers composed from ui/
<areas>/   → product UI (.tsx + co-located *.test.tsx only); composes @/components/ui/*
src/hooks/ → reusable and domain-scoped React hooks (.ts/.tsx)
src/lib/   → pure domain logic, transport clients, stores, and fluid tokens/contexts
src/routes → TanStack Router route modules and route-only page entry components
```

- **Strict UI-only `components/`**: Keep `web/app/src/components/` strictly for `.tsx` UI components and co-located UI tests (`*.test.tsx`). Pure helpers, stores, state machines, and schemas belong in `src/lib/<area>/`; React hooks belong in `src/hooks/<area>/`; route-only page modules belong in `src/routes/`.
- **`motion/` is dissolved**: Motion springs and Fluid primitives live in `src/lib/fluid/` and `src/components/ui/`, while area-specific animated components (`workspace/file-tree.tsx`, `chat/transcript/preview-rail.tsx`) live inside their owning product folders.
- **Exact `ui/` imports**: Import shared controls from their exact `@/components/ui/<file>` path. Do **not** relative-import into `ui/` or add catch-all barrel files.
- **No parallel controls or raw native controls**: Product areas compose `@/components/ui/*` (`Button`, `Input`, `Textarea`, `Select`, `Checkbox`, `Switch`, `Dialog`, `MobileDrawer`, `Collapsible`, `Tabs`, `Card`, `Item`, `CodeBlock`, etc.) instead of growing parallel controls or rendering raw `<button>`, `<input>`, `<select>`, `<textarea>`, or `<dialog>` elements (beyond explicitly documented exceptions in `web/app/component-sources.json`).
- **No static inline `style={{...}}`**: Use Tailwind utilities, CSS custom properties, or `@utility` helpers in `src/styles/globals.css` rather than static/themeable inline style objects outside `ui/`.
- **Behavior tests beside components**: Co-locate `*.test.tsx` beside the owning component and test accessibility, interactions, state, and composition contracts rather than snapshots.

```text
web/app/src/
  components/
    fluid-root.tsx # Top-level FluidRoot (LazyMotion strict, MotionConfig, Shape/Size/Icon providers)
    ui/            # @fluid Base UI primitives + AI Elements compositions/adapters
    openui/        # Generative UI library, charts, data views, HTML artifact shell, renderer
    artifacts/     # Session artifact drawer and run views
    chat/          # Chat workspace, composer, transcript, plans, subagents
    connectors/    # Connectors and MCP connections sections
    dashboards/    # Generative dashboard views and request cards
    layout/        # App shell, sidebar shell, header, right-panel shell/registry/launcher, resizable canvas
    sessions/      # Session sidebar, resource tree, agent tabs, session tree/insights
    settings/      # Settings dialog, sections, provider credentials
    tools/         # Session tool timeline, code block, file diff, approval, plan, todo, citations
    workspace/     # Workspace file tree/preview, resources, REPL panel
  hooks/           # Shared + domain-scoped React hooks (chat/, layout/, sessions/, settings/, workspace/)
  lib/             # Pure modules, clients, stores, fluid contexts/tokens (chat/, openui/, tools/, fluid/, ...)
  routes/          # TanStack Start file routes and route-only page components (-agents-page.tsx, connectors.tsx)
```

## Area & contract rules

1. Each product area imports shared UI from `@/components/ui/<file>` and keeps its non-UI helpers/hooks in `src/lib/<area>/` and `src/hooks/<area>/`.
2. Cross-area imports go through intentional entry components or hooks rather than another area's private sub-files.
3. `components/layout/` coordinates cross-area shell chrome (`ChatWorkspaceShell`, `RightPanelShell`, `ChatHeader`); it does not own feature state stores.
4. Wire contracts stay in `@prime-agent/web-protocol`; browser code never imports the Prime Agent runtime.
5. `web/app/scripts/component-contract-check.ts` and `scripts/check-web-boundaries.mjs` enforce basename uniqueness ("one name, one home"), dead-file checks, Base UI / `ui/` import boundaries, native control restrictions, narrow `*Props` interfaces, static inline-style hygiene, and stock Tailwind typography.

## Intentional deviations

- `chat/agent-chat.tsx` stays at the chat root (central surface with high import fan-out).
- `model-selector*`, `fork-picker-dialog.tsx`, `chat-welcome*` stay at the chat root.
- `tools/` stays flat without an extra `tools/core/` nesting layer.
