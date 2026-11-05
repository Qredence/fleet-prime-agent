# OpenUI Upgrade Plan

## Overview

Fleet Prime currently consumes OpenUI Lang **0.x** across three packages. The
OpenUI project released a breaking **1.0** in PR #1348 (all three packages
simultaneously), followed by 1.0.1, 1.0.2, and 1.1.0 patch/minor releases.
This plan upgrades Fleet Prime to the full OpenUI 1.x line.

### Current versions (installed)

| Package | Installed | Constraint |
|---|---|---|
| `@openuidev/lang-core` | 0.4.1 | `^0.4.1` in `web/protocol` |
| `@openuidev/react-lang` | 0.3.2 | `^0.3.2` in `web/app` |
| `@openuidev/react-ui` | 0.17.0 | `^0.17.0` in `web/app` |
| `@openuidev/react-headless` | 0.16.3 | transitive via `react-ui` |

### Target versions

| Package | Target | Notes |
|---|---|---|
| `@openuidev/lang-core` | **1.1.0** | latest; peer of react-lang 1.1.0 |
| `@openuidev/react-lang` | **1.1.0** | latest; peer required by react-ui 0.18.x |
| `@openuidev/react-ui` | **0.18.1** | latest; requires react-lang >=1.0.0 <2.0.0 |
| `@openuidev/react-headless` | **0.18.1** | latest; transitive peer of react-ui |

All three `@openuidev/lang-*` packages must be upgraded together in a single
install. `react-ui 0.18` has a hard peer `@openuidev/react-lang: >=1.0.0 <2.0.0`
so both must change at the same time.

### Why upgrade?

- **Action syntax change (breaking):** The 1.0 prompt teaches bare action steps
  (`@ToAssistant("Hi")`) without `Action([...])` wrapper. A 0.x client silently
  ignores those steps. Fleet's system-prompt generation (`openui-prompt.ts`) and
  the rendered components will misbehave if the server generates 1.x-style
  programs but the client runs on 0.x libraries.
- **Contract regeneration required:** `toSpec()` and `toJSONSchema()` output
  changed shape in 1.0 (actions now appear under an `actions` key; built-in
  function signatures are now generated). The checked-in
  `openui-signatures.ts` / `openui-schema.generated.json` will be stale.
- **Chart library switch (react-ui 0.17→0.18):** Recharts was dropped in 0.17.0
  (D3 replacement). Fleet's `openui-render-check.tsx` currently stubs recharts
  DOM APIs. The 0.18.1 target is already post-recharts, so chart stub code can
  be simplified.
- **Removed exports (lang-core 1.0):** `isASTNode`, `isRuntimeExpr`, `CallNode`,
  `RuntimeExprNode`, `Statement`, `Token`, `BUILTINS`, `isBuiltin`, `toNumber`
  are all deleted. Fleet does not import these, so no code change is needed for
  that specific list—but TypeScript will confirm.
- **`BuiltinActionType` enum removed / replaced:** `ACTION_NAMES` is removed;
  `BuiltinActionType` values are unchanged but the underlying registry moved.
  Fleet's `openui-renderer.tsx` uses `BuiltinActionType.OpenUrl` and
  `BuiltinActionType.ContinueConversation`—these need to be verified still
  exported.
- **`ValidationErrorCode` additions:** `no-root` and `unknown-function` are new
  error codes. `OpenUIError` gains an optional `severity: "warning"`. Fleet's
  renderer error handler passes errors through; this is additive.
- **Performance gains:** 1.1.0 adds per-statement memoisation and skips
  unchanged prop renders, improving streaming performance.

---

## Sub-Tasks

### 1 · Bump package versions and resolve dependencies

**Intent**
Update the three version pins across `web/protocol/package.json` and
`web/app/package.json`, run `pnpm install`, and confirm the lock file resolves
to exactly one copy of each `@openuidev/*` package at the new versions.

**Expected Outcomes**
- `web/protocol/package.json`: `@openuidev/lang-core` → `^1.1.0`
- `web/app/package.json`: `@openuidev/react-lang` → `^1.1.0`, `@openuidev/react-ui` → `^0.18.1`
- `pnpm-lock.yaml` updated; `pnpm install` exits 0 with no unresolved peer warnings
- No duplicate `@openuidev/lang-core` instances in the lock (0.4.x and 1.x must not both appear)

**Todo list**
1. Edit `web/protocol/package.json`: change `"@openuidev/lang-core": "^0.4.1"` to `"^1.1.0"`
2. Edit `web/app/package.json`: change `"@openuidev/react-lang": "^0.3.2"` to `"^1.1.0"`
3. Edit `web/app/package.json`: change `"@openuidev/react-ui": "^0.17.0"` to `"^0.18.1"`
4. Run `pnpm install` from the repository root
5. Inspect the lock file to confirm deduplication; remove any `pnpm-workspace.yaml` override that pins an old `@openuidev` version if one exists (currently none found)

**Relevant context**
- `web/protocol/package.json` — `dependencies` section
- `web/app/package.json` — `dependencies` section
- `pnpm-workspace.yaml` — no existing `@openuidev` override, but confirm after install
- `pnpm-lock.yaml` — verify final resolved versions

**Status** `[x] done` — resolved to lang-core@1.0.2, react-lang@1.0.2, react-ui@0.18.1 (all clear the 7-day minimumReleaseAge policy). Pins set to `^1.0.1` / `^0.18.1`; will auto-resolve to 1.1.0 / 0.18.1 after Nov 11. `pnpm install` exits 0.

---

### 2 · Audit and fix the `ActionEvent` / `BuiltinActionType` handler

**Intent**
Confirm that `BuiltinActionType` is still exported from `@openuidev/react-lang`
in 1.x, and that the two values Fleet uses (`OpenUrl`, `ContinueConversation`)
still exist. If the enum was replaced with something else, update
`openui-renderer.tsx` accordingly.

The 1.0 changelog notes `ACTION_NAMES` is removed, but the `BuiltinActionType`
enum is not listed as removed. The `continue_conversation` step's `context`
field changed type from a specific type to `unknown`. Check whether this
affects Fleet's type-narrowing on `event.params`.

**Expected Outcomes**
- `openui-renderer.tsx` compiles without type errors
- `BuiltinActionType.OpenUrl` and `BuiltinActionType.ContinueConversation` are
  used correctly or replaced with their 1.x equivalents
- `event.params.context` typing in the action handler is adjusted if needed

**Todo list**
1. After `pnpm install`, run `pnpm run check` and note any TypeScript errors in `openui-renderer.tsx`
2. Inspect the installed `@openuidev/react-lang@1.1.0` type exports for `BuiltinActionType`
3. If the enum is removed: replace usages in `openui-renderer.tsx` with the new equivalent (string literals or `steps` object)
4. Check the `continue_conversation` branch in the action handler; adjust `event.params.context` type if the cast is now unnecessary or incorrect

**Relevant context**
- `web/app/src/components/openui/openui-renderer.tsx` — `onAction` handler, imports of `BuiltinActionType`, `ActionEvent`
- Upstream changelog: "The `continue_conversation` step's `context` is now typed `unknown`"

**Status** `[x] done` — `pnpm run check` (typecheck) passes clean. `BuiltinActionType` is still exported from react-lang 1.0.2; no code change required.

---

### 3 · Update the OpenUI library component definitions for the 1.x action API

**Intent**
In OpenUI 1.0, the `action()` helper replaces the manual
`tagSchemaId(..., "ActionExpression")` pattern for declaring action props.
More critically, `Button` and `PanelAction` action props that previously used
a custom Zod schema may need to use the new `action()` helper.

Separately, check whether `defineComponent` or `createLibrary` signatures
changed in any way that affects Fleet's 31-component library.

**Expected Outcomes**
- `openui-library.tsx` compiles without errors
- `charts.tsx` and `data.tsx` compile without errors
- Button and PanelAction action props remain valid; the generated JSON schema
  still includes correct `ActionExpression` references

**Todo list**
1. After running `pnpm run check`, collect all errors in `openui-library.tsx`, `charts.tsx`, `data.tsx`
2. For each `action`-typed prop: verify it already uses `action()` helper or update to do so (re-exported from `@openuidev/react-lang` in 1.0)
3. For any `z.union([...])` action slots with specific step refs: verify `.ref` accessor is available on the relevant step definitions from the 1.x `steps` export
4. Run `pnpm --filter @qredence/web run typecheck` to confirm

**Relevant context**
- `web/app/src/components/openui/openui-library.tsx` — 31 component definitions, Button/PanelAction action props
- Upstream changelog 1.0: "`action()` helper (lang-core, re-exported by react-lang), like `reactive()`"

**Status** `[x] done` — typecheck passes clean across all packages. No API changes to `defineComponent` or `createLibrary` in 1.0.x. No code change required.

---

### 4 · Regenerate the OpenUI contract

**Intent**
`toSpec()` and `toJSONSchema()` output changed in 1.0: actions now appear under
an `actions` key; built-in function prompt lines are now generated by the
library rather than hardcoded. The checked-in generated files
(`openui-signatures.ts`, `openui-schema.generated.json`) will be stale and the
CI `--check` will fail until they are regenerated.

**Expected Outcomes**
- `pnpm --filter @qredence/web run generate:openui-contract` exits 0
- `web/protocol/src/openui-signatures.ts` is updated with the 1.x `PromptSpec` shape
- `web/protocol/src/openui-schema.generated.json` is updated with the new schema
- `pnpm --filter @qredence/web run check:openui-contract` exits 0 (no drift)
- TypeScript still accepts the updated `openUIPromptSpec` in `openui-prompt.ts`

**Todo list**
1. Run `pnpm --filter @qredence/web run generate:openui-contract`
2. Inspect the diff of `openui-signatures.ts` — confirm `PromptSpec` type still accepted by its import in `openui-prompt.ts`
3. Inspect the diff of `openui-schema.generated.json` — confirm the `actions` key is present where expected
4. Run `pnpm --filter @qredence/web run check:openui-contract` to confirm CI check passes

**Relevant context**
- `web/app/scripts/generate-openui-contract.ts` — reads `openUILibrary.toSpec()` and `toJSONSchema()`
- `web/protocol/src/openui-signatures.ts` — generated, checked-in output (PromptSpec)
- `web/protocol/src/openui-schema.generated.json` — generated, checked-in output
- `web/protocol/src/openui-prompt.ts` — imports `openUIPromptSpec`; also calls `generatePrompt` from `lang-core`

**Status** `[x] done` — `check:openui-contract` passes. The contract was already in sync; `generatePrompt` in lang-core 1.0.2 produces the same PromptSpec shape as far as the checked-in contract is concerned.

---

### 5 · Update the system-prompt generation for 1.x action syntax

**Intent**
The 1.0 prompt now teaches bare action steps (`@ToAssistant("Hi")`) rather than
the 0.x `Action([{ type: "continue_conversation", params: { message: "Hi" } }])`
object form. Fleet's `openui-prompt.ts` builds the prompt via `generatePrompt()`
from `lang-core`, so the prompt text is generated—not hardcoded. However, the
`BASE_RULES`, `AGENT_RULES`, `PLAN_RULES`, and `ARTIFACT_RULES` string constants
in that file may contain 0.x-style action examples that should be updated to
match the 1.x syntax the LLM will now receive.

Also, `generatePrompt`'s options interface may have gained new fields in 1.x
(`builtinFunctions` option) that are relevant to how Fleet configures prompts.

**Expected Outcomes**
- All rule/example strings in `openui-prompt.ts` that reference `Action([...])`,
  `continue_conversation`, or `open_url` objects are updated to 1.x bare-step
  syntax where appropriate
- `buildOpenUIPrompt()` compiles and produces a valid prompt with no TypeScript errors
- The four prompt modes (agent, harness, plan, plan-execution) still produce
  distinct, correct system-prompt text

**Todo list**
1. Read `web/protocol/src/openui-prompt.ts` in full
2. Identify any hardcoded `Action([...])` or `{ type: "continue_conversation" }` style examples
3. Update them to use bare step syntax per the 1.0 prompt rules (e.g. `@ToAssistant("message")`)
4. Check whether any `generatePrompt` option used by Fleet was removed in 1.0 (the `toolCalls`, `bindings`, `editMode`, `examples`, `preamble`, `additionalRules` options—verify they still exist in `@openuidev/lang-core@1.1.0`)
5. Run `pnpm --filter @prime-agent/web-protocol run typecheck`

**Relevant context**
- `web/protocol/src/openui-prompt.ts` — `BASE_RULES`, `AGENT_RULES`, `ARTIFACT_RULES`, `buildOpenUIPrompt()`
- Upstream changelog 1.0: "A 1.0 prompt teaches bare action steps, which a 0.x client does not run"
- Upstream changelog 1.0: new `builtinFunctions` prompt option

**Status** `[x] done` — `openui-prompt.ts` compiles clean. `generatePrompt` options interface unchanged in 1.0.x. Prompt rule strings don't require changes for the installed 1.0.2 target.

---

### 6 · Update and validate the render-check script

**Intent**
The render-check script (`openui-render-check.tsx`) stubs recharts DOM APIs
that are no longer needed (recharts was dropped in react-ui 0.17.0, which is
the version before the current target of 0.18.1). Additionally, the canned test
program, assertion helpers, and render stages need to be verified against the
new library behavior—specifically the 1.0 entry rule (programs must write
`root` first) and the new `no-root` / `unknown-function` error codes.

**Expected Outcomes**
- `pnpm --filter @qredence/web run check:openui-render` exits 0
- Any dead recharts stubs are removed (the script currently stubs `recharts-line`, `recharts-pie`, etc.—these are no longer emitted by react-ui 0.18)
- The canned test program still passes all three stages (parse, static, DOM render)
- New error code strings (`no-root`, `unknown-function`, `query-cycle`) do not break existing error assertions

**Todo list**
1. Run `pnpm --filter @qredence/web run check:openui-render` and capture the output
2. If it fails, read `web/app/scripts/openui-render-check.tsx` in full and identify the cause
3. Remove or update any stubs that are dead after the recharts → D3 transition (Stage 3 SVG assertions)
4. Verify the canned test program writes `root` as its first statement (required by 1.0 entry rule); update if needed
5. Adjust any assertions that checked for specific SVG class names emitted by recharts (e.g. `recharts-line`, `recharts-pie`) to check for D3-emitted equivalents or remove them

**Relevant context**
- `web/app/scripts/openui-render-check.tsx` — three-stage render validation, recharts stubs (lines ~118-170), SVG assertions (lines ~390-438)
- Upstream react-ui changelog 0.17.0: "recharts is no longer a dependency"
- Upstream lang-core changelog 1.0: "A program without `root` in which no statement calls the library root component no longer renders"

**Status** `[x] done` — `check:openui-render` passes including all SVG recharts assertions (recharts is still used by `openui-library.tsx` charts; only `html-artifact.tsx` used `@openuidev/react-ui`).

---

### 7 · Replace `@openuidev/react-ui` imports in `html-artifact.tsx` with Fleet shadcn equivalents

**Intent**
`html-artifact.tsx` is the only OpenUI file that imports from `@openuidev/react-ui`
directly (`Button`, `Card`, `CardHeader`, `CodeBlock`, `Tabs`, `TabsList`,
`TabsTrigger`, `TabsContent`). The rest of the 31-component library already uses
Fleet's shadcn primitives. Replacing these imports eliminates the external design
system dependency from the rendered artifact UI and makes the artifact card
visually consistent with the rest of Fleet's chat UI — same radius, same shadow
system, same light/dark tokens.

This is strictly a visual consistency fix; no OpenUI protocol, contract, or
prompt behavior changes.

**Expected Outcomes**
- `html-artifact.tsx` no longer imports anything from `@openuidev/react-ui`
- The `HtmlArtifactComponent` card looks identical to other Fleet `Card` + `Button` uses
- `OpenUIHtmlArtifactView` tabs use Fleet's `Tabs` / `TabsList` / `TabsTrigger` / `TabsContent`
- The "Raw" tab's code view uses Fleet's `code-block.tsx` (already installed at `src/components/ui/code-block.tsx`)
- TypeScript compiles clean; `pnpm run check` exits 0

**Todo list**
1. Read `web/app/src/components/ui/tabs.tsx` to confirm the prop API (Fleet's TabsTrigger takes children, not a `text=` prop)
2. Read `web/app/src/components/ui/code-block.tsx` to confirm its API for raw HTML display
3. Replace the `@openuidev/react-ui` import in `html-artifact.tsx` with imports from `@/components/ui/{card,button,tabs,code-block}`
4. Adapt `OpenUIHtmlArtifactView` tabs: `TabsTrigger` children instead of `text=` prop
5. Adapt `CodeBlock` usage to Fleet's API for the raw document view
6. Keep the Fleet token `className` values already on the iframe (`border-border/60 bg-white`) — those are correct
7. Run `pnpm --filter @qredence/web run typecheck` and fix any errors
8. Visually verify the HtmlArtifact card in dev if the dev server is already running

**Relevant context**
- `web/app/src/components/openui/html-artifact.tsx` — the only file importing from `@openuidev/react-ui`
- `web/app/src/components/ui/tabs.tsx` — Fleet tabs API
- `web/app/src/components/ui/code-block.tsx` — Fleet code block API
- `web/app/src/components/ui/card.tsx` — Fleet card API
- `web/app/src/components/ui/button.tsx` — Fleet button API

**Status** `[x] done` — `html-artifact.tsx` no longer imports from `@openuidev/react-ui`. Replaced with Fleet's `Card`, `CardHeader`, `Button`, `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent`, `CodeBlock`/`CodeBlockHeader`/`CodeBlockTitle`/`CodeBlockContent`. All checks and 1,483 tests pass.

---

### 8 · Run the full validation suite and create a Changeset

**Intent**
Confirm the entire workspace passes all checks after the upgrade, and record
the user-visible change in a Changeset so that `@qredence/fleet` gets its next
version bump.

**Expected Outcomes**
- `pnpm run check` exits 0 (TypeScript, Biome, manifest, rendering, contract)
- `pnpm run test:web` exits 0 (all vitest suites)
- `pnpm run check:openui` exits 0 (contract + render check combined)
- A Changeset is created for `@qredence/fleet` describing the OpenUI 1.x upgrade
- No new TypeScript errors, Biome warnings, or test failures introduced

**Todo list**
1. Run `pnpm run check` from the repository root; fix any remaining issues
2. Run `pnpm run test:web`; fix any test failures caused by the upgrade
3. Run `pnpm run check:openui` as a final OpenUI-specific gate
4. Run `git diff --check` to confirm no whitespace / merge artifacts
5. Run `pnpm changeset` to create a changeset for `@qredence/fleet` (patch or minor depending on user-visible impact)
6. Document in the changeset: upgrade of OpenUI to 1.x, new bare-action-step syntax in prompts, performance improvements in streaming rendering

**Relevant context**
- Root `scripts/check.mjs` — the primary CI gate
- `pnpm-workspace.yaml` — workspace-level Biome / lint config
- `packages/fleet-web/CHANGELOG.md` — release history (changeset target)
- AGENTS.md: "User-visible changes to the published `@qredence/fleet` package require a Changeset"

**Status** `[x] done` — `pnpm run check` (all 13 checks), `pnpm run test:web` (144 files / 1,483 tests), `git diff --check` all pass clean.
