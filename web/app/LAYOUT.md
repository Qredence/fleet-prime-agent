# Fleet layout & Fluid tokens

## Fluid provider root & surface system

The app root (`src/routes/__root.tsx`) mounts `<FluidRoot>` (`src/components/fluid-root.tsx`), which configures:

- `<LazyMotion features={domMax} strict>` and `<MotionConfig reducedMotion={...}>`
- `<ShapeProvider defaultShape="rounded">` (`src/lib/fluid/shape-context.tsx`)
- `<SizeProvider size="default" | "compact">` (`src/lib/fluid/size-context.tsx`, synced with UI density preferences)
- `<IconProvider>` (`src/lib/fluid/icon-context.tsx`)

Visual elevation uses the `@fluid` 8-step surface and shadow ladder in `src/styles/globals.css` (`--surface-1`..`--surface-8`, `--shadow-1`..`--shadow-8`) paired with `SurfaceProvider` / `surfaceClasses` (`src/lib/fluid/surface-context.tsx`, `src/lib/fluid/surface-classes.ts`).

Interactive focus and selection accent uses `--fluid-accent: #3b82f6` (`--focus-ring: var(--fluid-accent)`).

## Grid & density scale

Base unit: **4px**. Structural layout and container spacing snap to a 4px base grid (**4 / 8 / 12 / 16 / 24 / 32 / 48** px). Narrow optical adjustments (`gap-1.5`, `px-2.5`) are permitted inside compact controls.

| Token                      | Value (default)    | Value (`[data-density="compact"]`) | Role                                       |
| -------------------------- | ------------------ | ---------------------------------- | ------------------------------------------ |
| `--density-header-height`  | `44px` (`2.75rem`) | `40px` (`2.5rem`)                  | Header height across chat and panels       |
| `--density-control-height` | `36px` (`2.25rem`) | `28px` (`1.75rem`)                 | Standard control height in headers         |
| `--density-gap`            | `16px` (`1rem`)    | `16px` (`1rem`)                    | Header / stack gaps                        |
| `--density-pad-x`          | `24px` (`1.5rem`)  | `16px` (`1rem`)                    | Shell inset (chat column, panels, dialogs) |

Shell density tokens and Fluid `SizeProvider` follow the same preference: `comfortable` maps to `default` (36px controls), and `compact` maps to `compact` (28px controls). Headers retain space around controls (44px default, 40px compact). Local explicit primitive size overrides remain supported. Chat chrome offsets derive from the active header height in CSS.

## Shared CSS `@utility` classes (`src/styles/globals.css`)

- `chat-column`: centers the chat thread/composer measure (`max-width: var(--chat-measure)` = `768px`, `padding-inline: var(--density-pad-x)`).
- `hit-area-expand`: `position: relative` with a centered `40px × 40px` invisible `::after` hit target for visually compact controls.
- `hit-area-expand-dense`: vertical-only `::after` hit expander (`top: -0.375rem; bottom: -0.375rem; inset-inline: 0`) for adjacent dense items.
- `no-scrollbar`: provided by `shadcn/tailwind.css` for horizontally/vertically scrollable strips without visible scrollbars.

## Concentric radius

| Token / class                             | Value             | Use                                            |
| ----------------------------------------- | ----------------- | ---------------------------------------------- |
| `--radius-sm` / `rounded-sm`              | `8px` (`0.5rem`)  | Inner rows, nested chips                       |
| `--radius-md` / `rounded-md`              | `16px` (`1rem`)   | Shell, cards, overlays, dialogs                |
| `--radius` / `rounded-lg` … `rounded-4xl` | `24px` (`1.5rem`) | Collapsed outer step (composer, pill controls) |
| `--radius-pill` / `rounded-full`          | `9999px`          | Circular / pill controls only                  |

Chat aliases: `--chat-measure` (`768px`), `--chat-input-radius` (`1.5rem`), `--chat-message-radius-inner` (`1rem`), `--chat-tool-radius` (`calc(var(--radius) * 0.8)`).

## Typography

- **Font**: **Inter Variable** (`@fontsource-variable/inter/opsz.css`) with optical sizing enabled; weights **400 / 500 / 600** max.
- **Scale**: Product components use stock Tailwind typography classes (`text-xs`, `text-sm`, `text-base`, `text-lg`, `text-xl`). Arbitrary `text-[0.*]` sizes and legacy custom classes (`text-micro`, `text-caption`, `text-label`, `text-body`, `text-headline`) are disallowed.
- `@fluid` primitives in `src/components/ui/` may also consume the `--fs-*` / `--lh-*` ladder via `src/lib/fluid/type-scale.ts` so controls adapt cleanly between `default` and `compact` density modes.

## Chat Typeset

Chat markdown uses `src/styles/typeset.css` with `.typeset.typeset-chat`:

| Token                           | Value                               | Role                              |
| ------------------------------- | ----------------------------------- | --------------------------------- |
| `--typeset-font-body` / heading | `var(--font-sans)` (Inter Variable) | Matches Inter Variable font stack |
| `--typeset-size`                | `0.875rem`                          | 14px prose reading size           |
| `--typeset-leading`             | `1.6`                               | Chat reading rhythm               |
| `--typeset-flow`                | `1em`                               | Block spacing inside messages     |

Use `not-typeset` / `data-not-typeset` on embedded UI controls inside markdown so prose spacing rules do not leak into interactive widgets.
