# Fleet Prime whole-app design review

Review date: 2026-11-15. This review covers the three browser routes and their product-area compositions. Findings below are source-derived unless explicitly marked as browser-observed. Source review and passing checks are not visual approval.

## Inventory and coverage

| Entry / surface | States reviewed in source | Existing composition / review result |
| --- | --- | --- |
| `/` chat workspace | Welcome, transcript, streaming, reasoning, tool activity, queue, loading, errors | Existing Message/MessageScroller/Bubble/Trace adapters retained; composer semantic tokens consolidated; shared Skeleton replaces three handmade lazy-loading placeholders. |
| Model selector / composer menus | Closed/open, model/effort choice, lazy loading, disabled | Existing Popover/InputGroup retained; loading uses shared Skeleton. |
| Session navigation | Projects, session tree, search, activity, insights, rename/delete/unregister, create project | Shared Button/Dialog/AlertDialog and typed navigation retained; vertical layout uses gap-based stacks. |
| Subagents | List, nested children, transcript, activity states | Existing shared controls and depth-driven layout retained; stack spacing consolidated. |
| Workspace / files | Loading, unavailable, error, file tree, selected preview, preview timeout, split/mobile layout | Existing Alert/Skeleton and accessible resize separator retained; runtime-computed dimensions are intentional. |
| Resources | Loading, catalog groups, diagnostics | Existing Badge/Skeleton/Alert compositions retained. Settings-specific provenance work belongs to the settings/adapter changes. |
| Artifacts | Empty, error, run list, selected content | Existing components retained; vertical stacks use gap spacing. |
| REPL | Empty, run list, selected run | Existing controls and computed output layout retained; vertical stacks use gap spacing. |
| Session tools | Approval, plan/todo, result, citations, code, diff, images | Typed lifecycle presentation retained; syntax color pairs and computed maximum heights are intentional. |
| Dashboards | Empty, selected board, saved program, cloud response, old-format/error | Shared Alert retained; long board titles truncate within their controls. No provider generation was used for this review. |
| OpenUI | Chart/data/list/form compositions, render errors | Semantic palettes retained; metric cards use one column on small screens and wrap value/delta content. Generated document and syntax colors remain separate from chrome theme tokens. |
| `/agents` | Loading, error, empty, recent sessions, unsupported scheduling cards | Shared Spinner replaces standalone loading icon; page follows stock title scale, shared density header/inset, and gap stacks. |
| `/connectors` | Loading/error, MCP manager | Shares the product header and the same MCP manager as Settings. MCP content changes and tests are owned by the integration work. |
| Settings | Sections, search, drafts, save scope, Skills, MCP, confirmation | Covered by settings implementation and regression tests; not treated as the only product surface. |
| Shared shell | Header, desktop sidebar, mobile panels, resizable canvas, error fallback | Product-page headers now follow density tokens and cn conventions; error boundary composes Alert/AlertTitle/AlertDescription. |

## Fixed source findings

- **Moderate, Derived — density drift** (`rule/spacing-on-scale`): `product-page-header.tsx` used a separate fixed header and page inset. It now uses `--density-header-height` and `--density-pad-x`, matching the chat/panel shell.
- **Moderate, Derived — duplicate loading compositions** (shadcn component reuse): lazy model/tool/reasoning fallbacks hand-built pulse blocks. They now use the installed Skeleton with their accessible loading names preserved.
- **Moderate, Derived — competing theme composition** (shadcn semantic color principle): the composer repeated identical dark/background utilities and a custom foreground variable expression. It now relies on semantic utilities.
- **Moderate, Inferred — narrow metric layout** (`rule/redesign-matches-requested-scope`): two fixed metric columns and a non-wrapping value/delta row increased overflow pressure. Metrics now stack on small screens and wrap their inline values. Rendered width verification is required before treating this as measured.
- **Minor, Derived — repeated error callout markup** (shadcn component reuse): the shared error boundary hand-built its destructive callout. It now composes the installed Alert family while preserving Retry.
- **Minor, Derived — inconsistent stack classes** (shadcn gap principle): Agents, message queue, subagent list and the earlier artifact/session/workspace cleanup use explicit flex/gap rather than sibling-margin spacing.
- **Minor, Inferred — long dashboard selection titles**: selected-board buttons now constrain their label with truncation, preserving the title text and selection behavior.

## Better Design comprehension pass

Better Design checked representative visible copy for chat, Agents, Workspace, Resources, Artifacts, Dashboards, Insights, and tool approval. It returned no blocking comprehension findings. It flagged “session” and “workspace” as potentially unfamiliar; these are established product/domain terms, and the Agents page already explains conversations. This was a text-only sample, not a screen-reader audit or a measurement of every runtime-generated string.

The user explicitly chose the existing Fluid/Base UI identity. No alternate design-system catalog or registry replacement was applied.

## Intentional exceptions and limits

- Syntax highlighting light/dark color pairs, diff colors, chart-series colors, and fixed white exported-document canvases are data/content presentation rather than duplicate application palettes.
- Virtualization offsets, panel widths, tree depth, image aspect ratios, and output maximum heights are computed layout values, so inline styles are intentional.
- Markdown lists and horizontal rules preserve document semantics rather than being rewritten as interactive product layout.
- There is no installed Empty primitive; existing small empty-state copy was retained instead of adding a new dependency or parallel abstraction.
- Unsupported scheduling remains explicitly unavailable; no new runtime feature is implied by the visual cleanup.

## Browser evidence

The final browser observations are recorded below. Runtime-generated dashboards, paid provider responses, and destructive actions were not created merely to obtain screenshots; those states are explicitly marked as not reached.

## Implementation completion

- Settings now separates Fleet preferences, model/provider configuration, runtime controls, resource paths, and integrations. Legacy section entry IDs still open their replacement section.
- Settings search includes individual controls and focuses matching controls. Every visited section remains mounted, while a metadata-only registry tracks credential/configuration drafts and pending saves. Close/discard applies to all forms; section Cancel and Save operate independently.
- Runtime saves explicitly select user or project scope. User defaults are projected independently from project overrides, which remain visible in the scope explanation. No secret values are included in these projections.
- Skills combines configuration discovery with an optional, same-workspace existing-session daemon snapshot. Empty/cold snapshots are distinguished from absence of discovered skills. Paths remain editable above the searchable catalog; long descriptions and provenance have expandable details.
- MCP shares one manager between Settings and Connectors. Exact argument rows, environment-variable mappings, validation, duplicate replacement confirmation, cancellation, daemon status, and terminal sign-in guidance are implemented. Long setup instructions now live in expandable details.
- Whole-app fixes include shared root theme initialization, semantic focus/sidebar/chat tokens, density-driven headers, shared loading/error components, responsive OpenUI metrics, and gap-based layouts across sessions, artifacts, workspace, queues, subagents, and Agents.

## Browser observations (2026-11-15)

| Surface | Observed coverage | Result |
| --- | --- | --- |
| All 14 settings sections | DOM geometry at 390, 1440, and 1728px; section navigation and search | Page width matched viewport; section scroll width matched its client width in every measured section. No horizontal overflow observed. |
| Settings search / runtime draft | Search for Reserved context tokens; focus; edit without saving; navigate away/back; close | Search focused the input, draft value survived, Unsaved marker appeared, and closing offered Keep editing / Discard changes. Review draft was discarded. |
| Appearance / shell density | Comfortable and compact; light and dark; computed density tokens | Compact applied 40px header and 28px control tokens. Original comfortable density restored. Temporary color-scheme emulation cleared. |
| Responsive settings with an already-open panel | Resize desktop to mobile while Settings is open | Found a competing mobile drawer focus bug. Fixed by suspending that drawer while Settings owns focus; mobile section selector then worked. Added regression coverage. |
| `/agents` | 390, 1440, 1728px; loading and populated recent-session list; light and dark | Shared header and content hierarchy remained readable. Found/fixed missing root theme initialization on direct route load. |
| `/connectors` | 390, 1440, 1728px; catalog/loading, connection states, collapsed details | Catalog remains scannable; long descriptions/instructions are disclosed per server. Mobile pane actions stack below descriptions. |
| `/` chat shell and navigation | Mobile/desktop; both themes; welcome/composer and project/session sidebar | Composer and navigation stayed within viewport; existing controls and chat composition retained. |
| Workspace / Resources / Session insights / Subagents | Desktop file tree and preview empty state; resource empty/populated states and refresh; runtime summary; subagent empty state | Shared panel structure, loading and recovery states observed. A hot-reload-only missing snapshot seam now falls back to configuration discovery. |
| Artifacts / Dashboards | Panel navigation and loading states | Loading uses shared Skeleton. Populated runtime-generated artifacts/dashboard visual states were not created for this review. Deterministic renderer tests cover their modified compositions. |

### Validation limits

This is a whole-app source review plus browser review of reachable states, not a claim of exhaustive visual coverage of every provider response, generated dashboard, tool approval, or error. No paid model turn, OAuth login, credential change, destructive action, deployment, or publication was used to create missing states. Better Design's spacing capture guidance was consulted, but no complete tool spacing score is claimed. Source and deterministic tests cover the remaining runtime-dependent render paths.

## Final checks

- `pnpm run check`: passed, including runtime pin, formatting, lint, boundaries, browser import graph, render contracts, registries, and workspace typechecks.
- `pnpm run test:web --maxWorkers=4`: passed (61 protocol, 992 server, 672 app tests).
- `pnpm run test:release`: passed (114 tests).
- `pnpm run check:changeset` and `git diff --check`: passed.
- The full parallel UI run exposed a one-second cold Markdown import wait; the existing preview test now allows five seconds for the actual render, with no production timeout change. Focused preview tests and the subsequent complete suite passed.

## Pre-commit review

Standards and plan-compliance reviews found and resolved six lifecycle/usability regressions: clean remote settings refresh, saved package-row refresh, cancellation after invalid package JSON, unadded resource path drafts, close/discard precedence while any save is pending, and credential-specific search focus. Regression tests cover these cases. The follow-up reviews reported no actionable residual findings.

The default-concurrency test run hit a one-second sidebar interaction timeout. The complete workspace suite passed with four workers (1,725 tests); no production timing behavior was changed for that sidebar case. Static checks, 114 release tests, Changeset validation, and diff checks passed.
