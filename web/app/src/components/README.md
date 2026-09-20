# Component areas map

The Fleet Prime web application owns its UI source. Components live under
`web/app/src/components/`, grouped by product area, and are imported through
the application's `@/*` alias.

## Layer rules

```text
ui/        → interactive primitives (Button, Select, Popover, Command, Checkbox, Radio, Input, …)
openui/    → generative UI surfaces built on the same primitives
<areas>/   → product composition only; compose ui via @/components/ui/*
motion/    → motion-only helpers (no parallel Select/Combobox/Popover/Checkbox/Radio/Input)
```

- Compose `@/components/ui/...` — do **not** relative-import into `ui/`.
- Do **not** add parallel form/overlay controls under `motion/` (or elsewhere).
  New `@beui` installs that are interactive primitives belong in `ui/`;
  motion-only chrome stays in `motion/`.
- `openui/` wraps `ui` for generative surfaces; product areas should not
  reimplement those primitives.

```text
components/
  ui/          # Base UI/shadcn primitives
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
