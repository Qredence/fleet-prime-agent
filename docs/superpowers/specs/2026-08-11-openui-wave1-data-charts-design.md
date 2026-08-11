# OpenUI Wave-1: Data display & charts for the custom library

**Date:** 2026-08-11 · **Status:** awaiting user spec review · **Approved direction:** Option A (extend custom `openUILibrary`), two-file split, Lean-trio+MetricGroup inventory.

## Context

Fleet's Pi assistant already renders OpenUI Lang inside chat messages via `GenerativeTextRenderer` + the custom `openUILibrary` (22 defs, `Root` program root, `@openuidev/react-lang@0.2.11`). The goal is a richer library so generated UIs communicate data better — first wave of four: **LineChart, DonutChart, DataTable (v2), MetricGroup**. Other families (forms & validation, media & layout, feedback & flow) become follow-on waves reusing this spec's component recipe.

**Baseline facts that constrain the design**

- Library lives in `packages/web-design/src/components/openui/`; assembled via `createLibrary({ components: [...] })`, root component `Root` (unchanged).
- Existing data convention (model-visible, must mirror): `BarChart(title, description?, xAxisKey, series[{dataKey, label}], data[{...}])`.
- Post-triage codebase mandates: named top-level function components per def (rules-of-hooks stays armed), props typed to zod output shapes (`StateField<T>` for reactives — none in this wave), file-splitting to keep `openui-library.tsx` from growing unreviewably.
- Primitives already available: `chart.tsx` (`ChartContainer`, `ChartTooltip`, `ChartTooltipContent`, `ChartLegend`, `getChartColorVarName`, `var(--chart-N)` tokens), `../card`, `../table`, tones module. recharts 3.9 is bundled — **no new dependencies**.
- LLM ergonomics: zod key order = positional args; mirror BarChart's exact convention (`title`, `description?`, …) even where that puts an optional prop before a required one (optional positional args can be skipped with `null`); every prop needs a `.describe()` (it feeds `library.prompt()`).
- Streaming: components render under partial programs frequently; no layout-property animation anywhere (react-doctor P-zero error class), no hydration-unsafe seeds.

## Architecture

```
packages/web-design/src/components/openui/
  openui-library.tsx        # assembles createLibrary({ components: [...existing, ...chartsDefs, ...dataDefs] })
  charts.tsx                # NEW — LineChartDef, DonutChartDef + shared chart helpers
  data.tsx                  # NEW — DataTableDef, MetricGroupDef + shared formatting helpers
  scripts/openui-render-check.tsx   # versioned harness (triage harness made permanent)
```

- `openUILibrary` export name and `Root` root: unchanged → zero breakage for existing prompts/outputs.
- Each def = named module-scope function component (e.g. `function LineChartComponent(...)`) referenced by `component:` in its `defineComponent`, matching the post-react-doctor pattern.
- Shared helpers (`buildChartConfig`, number coercion, currency/percent formatters) are module-scope inside their file, not exported into the public `web-design` surface (`export {}` only for defs consumed by the assembly).

## Components

### 1. `LineChart` — `openui/charts.tsx`

Trend visualization. Mirrors BarChart's convention exactly.

| # | Prop | Type | Notes |
|---|---|---|---|
| 1 | `title` | `string` | required |
| 2 | `description?` | `string` | |
| 3 | `xAxisKey` | `string` | key into row objects |
| 4 | `series` | `Array<{ dataKey: string; label: string; color?: string }>` | color defaults to `var(--chart-(i%5)+1)` |
| 5 | `data` | `Array<Record<string, string \| number>>` | |

Render: `Card` shell (max-w-3xl, same as BarChart), `ChartContainer` with config built from series, recharts `LineChart` + `Line` per series (`stroke` from config, `dot={false}` for streaming smoothness, `strokeWidth={2}`), `CartesianGrid vertical={false}`, `XAxis` (no tick/axis line), `ChartTooltip`. Empty `data`/`series` → muted "No data" notice div instead of a broken recharts mount. Numeric coercion (`Number(v)`) with NaN rows filtered before passing to recharts.

### 2. `DonutChart` — `openui/charts.tsx`

Composition visualization.

| # | Prop | Type |
|---|---|---|
| 1 | `title` | string |
| 2 | `description?` | string |
| 3 | `segments` | `Array<{ label: string; value: number; color?: string }>` |
| 4 | `centerLabel?` | string |

`PieChart` with `innerRadius=55`, `Cell` per segment (color fallback `var(--chart-N)`), `ChartTooltip`, centered absolute label when `centerLabel` given. Sum shown in tooltip values via `ChartTooltipContent` pattern. Zero/negative values filtered; empty after filter → "No data" notice.

### 3. `DataTable` — `openui/data.tsx` (v2 of `Table`)

Typed, sortable; deliberately **no pagination** (model controls row counts; client paging is UI-for-UI's-sake inside chat width).

| # | Prop | Type |
|---|---|---|
| 1 | `title?` | string |
| 2 | `columns` | `Array<{ key: string; label: string; type?: "text" \| "number" \| "currency" \| "percent"; align?: "left" \| "right" }>` |
| 3 | `rows` | `Array<Record<string, string \| number>>` |

- Client sorting: header click cycles `asc → desc → off` (pure `useState` cycle; default type-aware comparator: `Intl.Collator` for text, numeric for number/currency/percent; stable order restored on "off").
- Formatting: currency via `Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })`; percent via `{ style: "percent", maximumFractionDigits: 1 }` (values 0–1 showcased as fractions; ≥1 treated as already-percent). Both formatters module-scope, unit-tested.
- Styling reuses `../table` primitives; numbers right-align by default when `align` omitted.
- Empty `rows` → muted notice row.

### 4. `MetricGroup` — `openui/data.tsx`

KPI cards trio/quad with trend accent.

| # | Prop | Type |
|---|---|---|
| 1 | `metrics` | `Array<{ label: string; value: string \| number; delta?: string; deltaTone?: "up" \| "down" \| "neutral"; sparkline?: number[] }>` |

- Grid `grid-cols-2` (chat width), up to 4 metrics per group; each = compact `Card`: muted small label, `text-xl` semibold value, optional `Badge` delta with tone classes (up=success/emerald, down=danger, neutral=muted via tones module).
- `sparkline`: ≥2 points → inline 48×16 recharts `Area` (no axes, same `var(--chart-N)` assignment by metric index) — recharts import cost already paid by LineChart/DonutChart defs.
- 1–2 metrics also render fine (grid-cols-auto fill).

## Data flow / actions

All four are leaf render components — no children, no `renderNode`, no `Query`/`Mutation` (explicit wave-1 defer; the runtime exists in lang-core when a later wave needs it). Table sorting is the only local state (`useState` inside the named component function — rules-of-hooks compliant).

## Error handling

- Shape errors → zod parse failures → existing `OpenUIDiagnostics` correction loop in `openui-renderer.tsx` (untouched).
- Runtime guards: empty/invalid data filtered per-def above; NaN/negative values handled per chart; no throws from render paths.
- Color fallback always present (`var(--chart-(i%5)+1)`), so single-segment/series cases still render.

## Testing & verification

1. **Versioned harness** (triage's throwaway made permanent): `packages/web-design/scripts/openui-render-check.tsx` — happy-dom + `createParser(openUILibrary.toJSONSchema(), "Root")` validation of a canned v0.5 program covering all four new defs + the five refactored ones + SSR render via `renderToStaticMarkup` with content assertions (line path count, arc slices, sorted rows, sparkline path presence). Registered as `npm run check:openui` in web-design.
2. **Vitest** (`packages/web-design` — add vitest if absent): unit tests for the two extractable pure helpers (DataTable comparator cycle + currency/percent formatters, `buildChartConfig`).
3. **Gates per commit**: `tsc --noEmit` (web-design), repo pre-commit suite (husky), `npx @openuidev/cli@latest generate` on the library file (prompt/spec regeneration sanity), react-doctor@0.9.4 rescan — **errors must stay 0; no new rule types in touched files**.
4. **Browser spot-check**: agent-browser screenshot of each component rendered through the chat pipeline (standard, same as triage's tabs check).
5. **Commits (progressive, husky-gated)**: ① harness + check script, ② LineChart+DonutChart, ③ DataTable, ④ MetricGroup, ⑤ tests+docs touch-up.

## Out of scope (explicit)

Query/Mutation runtime wiring, pagination, children/nesting inside chart/table cells, `@openuidev/react-ui` adoption, server-side prompt changes (prompt text is regenerated from the library by the existing `generate-openui-signatures` flow — verified green in gate ③), the other three component families.
