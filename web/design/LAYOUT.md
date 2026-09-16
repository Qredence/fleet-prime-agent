# Fleet layout tokens

## Grid

Base unit: **8px**. All spacing and radii snap to this grid.

## Space scale

Allowed values only: **8 / 16 / 24 / 32 / 40 / 48** (px).

| Token | Value | Role |
| --- | --- | --- |
| `--density-gap` | 16px (`1rem`) | Header / stack gaps |
| `--density-pad-x` | 24px (`1.5rem`) | Shell inset (chat column, panels, dialogs) |
| compact `--density-gap` | 16px | Same gap, tighter pad |
| compact `--density-pad-x` | 16px | Compact inset |

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
