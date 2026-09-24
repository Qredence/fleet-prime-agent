# Fleet layout tokens

## Grid

Base unit: **4px**. Structural layout and container spacing snap to a 4px base grid with a preferred scale of **4 / 8 / 12 / 16 / 24 / 32 / 48** px. Narrow optical adjustments (such as 6px / `gap-1.5` or 10px / `px-2.5`) are permitted inside compact control primitives.

## Space & Density scale

| Token | Value | Role |
| --- | --- | --- |
| `--density-header-height` | 44px (`2.75rem`) | Header height across chat and desktop panels |
| `--density-control-height` | 36px (`2.25rem`) | Standard button/control height in headers |
| `--density-gap` | 16px (`1rem`) | Header / stack gaps |
| `--density-pad-x` | 24px (`1.5rem`) | Shell inset (chat column, panels, dialogs) |
| compact `--density-header-height` | 40px (`2.5rem`) | Compact header height across adjacent panes |
| compact `--density-control-height` | 32px (`2rem`) | Compact button/control height in headers |
| compact `--density-gap` | 16px (`1rem`) | Compact gap |
| compact `--density-pad-x` | 16px (`1rem`) | Compact inset |

## Shell inset

**24px** horizontal inset on panels, dialogs, and the chat column (`CHAT_COLUMN_CLASS` → `--density-pad-x`).

## Concentric radius

Shell / card: **24px**. Nested surfaces step inward by 8px:

| Token / class | px | Use |
| --- | --- | --- |
| `--radius-sm` / `rounded-sm` | 8 | Inner rows (`rowSurface`), nested chips |
| `--radius-md` / `rounded-md` | 16 | Mid chrome (header pills) |
| `--radius` / `rounded-lg` … `rounded-4xl` | 24 | Shell, cards, overlays, dialogs |
| `--radius-pill` / `rounded-full` | pill | Circular / pill controls only |

`--radius` is `1.5rem` (24px). Larger Tailwind radius steps collapse to the shell value so surfaces stay concentric.

Chat aliases: `--chat-input-radius` = 24px; `--chat-message-radius-inner` = 16px.

## Type

Font: **Inter Variable** only.

Default trio:

| Role | Size | Token |
| --- | --- | --- |
| Label | ~12px | `--text-label` (`0.75rem`) |
| Body | ~14px | `--text-body` (`0.875rem`) |
| Headline | ~18px | `--text-headline` (`1.125rem`) |

Caption (`--text-caption`) only in dense tools.

## Weight

Per component: **400 / 500 / 600** max. No 700+.

## Chat Typeset

Chat markdown uses shadcn Typeset (`src/styles/typeset.css`) with Fleet preset `.typeset-chat` (`src/styles/typeset-presets.css`):

| Token | Value | Role |
| --- | --- | --- |
| `--typeset-font-body` / heading | `var(--font-sans)` (Inter Variable) | Matches Type section |
| `--typeset-size` | `0.875rem` | Body 14 |
| `--typeset-leading` | `1.6` | Chat reading rhythm |
| `--typeset-flow` | `1em` | Tighter block spacing than docs |

Wrapper classes: `typeset typeset-chat`. Nested UI chrome inside markdown should use `not-typeset` / `data-not-typeset` when needed. Streamdown code-block chrome stays in `agent-ui.css` under `.typeset`.
