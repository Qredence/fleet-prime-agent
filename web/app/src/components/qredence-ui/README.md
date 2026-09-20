# qredence-ui directory map

Coherent folders under `web/design/src/components/qredence-ui/`. Public behavior is unchanged; deep imports under `@prime-agent/web-design/components/qredence-ui/*` still resolve via package path maps.

## Layer rules

```text
ui/            → interactive primitives (Button, Select, Popover, Command, Checkbox, Radio, Input, …)
qredence-ui/   → product composition only; import ui via package path
motion/        → motion-only helpers (no parallel Select/Combobox/Popover/Checkbox/Radio/Input)
```

- Compose `@prime-agent/web-design/components/ui/...` — do **not** relative-import `../ui/...`.
- Do **not** add parallel form/overlay controls under `motion/` (or elsewhere in qredence-ui). New `@beui` installs that are interactive primitives belong in `ui/`; motion-only chrome stays in `motion/`.
- `openui/` wraps `ui` for generative surfaces; qredence-ui should not reimplement those primitives.

```text
qredence-ui/
  chrome/          # shell tokens, pills, hit areas
  layout/          # app chrome: sidebar, header, right-panel shell/registry
  motion/          # motion-only helpers (action-swap, file-tree, preview-rail, runtime, shared-layout-bg)
  chat/
    agent-chat.*   # main chat surface (kept at chat root — high import fan-out)
    agent-ui.css   # chat tokens + streamdown chrome (Typeset-adjacent)
    markdown/      # markdown.tsx, markdown-code.tsx, lazy-markdown.tsx
    composer/      # prompt-input, input-bar*, composer-*, input/
    message/       # message*, user-message, streaming-*, virtualized-*, turn-status, payload-part
    thinking/      # reasoning / progress
    question/      # question prompts
    hooks/ utils/  # chat-local helpers
  panels/
    settings/      # settings-dialog, settings-sections, settings form hooks
    session/       # session-tree, session-insights*, transcript-*
    workspace/     # workspace/artifacts/resources/repl/canvas/launcher/shared/skeletons
    subagents/     # subagents-panel, subagent-composer, subagent-transcript
    config-panel/  # settings section UIs shared with settings dialog
    hooks/         # panel-local hooks (e.g. workspace split layout)
  tools/           # tool renderers + registry (left mostly flat)
```

## Intentional deviations

- `agent-chat.tsx` stays at `chat/` root (hundreds of import sites / central surface).
- `model-selector*`, `fork-picker-dialog`, `chat-welcome*`, `types.ts`, `icons.tsx` stay at chat root.
- `tools/` not re-grouped into `tools/core/` in this pass (subtractive preference).
