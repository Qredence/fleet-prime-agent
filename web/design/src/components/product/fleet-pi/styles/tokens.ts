import { cva } from "class-variance-authority";

/** Small commit / add actions inside config sections. */
export const COMPACT_ACTION_BUTTON_CLASS =
	"h-8 shrink-0 cursor-pointer rounded-[7px] border-border/45 bg-background/65 text-[11px] font-semibold text-foreground/75 shadow-sm transition-[background-color,border-color,box-shadow,opacity,transform] duration-150 hover:bg-foreground/5 active:scale-[0.96] disabled:opacity-50";

/**
 * Invisible 40×40 hit-area expander for visually dense controls.
 * Use on isolated icon buttons. Prefer HIT_AREA_EXPAND_DENSE_CLASS when
 * neighbors are within gap-1 so expanders do not overlap.
 */
export const HIT_AREA_EXPAND_CLASS =
	"relative after:absolute after:top-1/2 after:left-1/2 after:size-10 after:-translate-x-1/2 after:-translate-y-1/2";

/**
 * Vertical-only hit-area expander for adjacent dense controls.
 * Extends height toward 40px without widening past the control.
 */
export const HIT_AREA_EXPAND_DENSE_CLASS = "relative after:absolute after:inset-x-0 after:-top-1.5 after:-bottom-1.5";

/** Floating header pills and inactive launcher chrome. */
export const CHROME_PILL_CLASS =
	"relative inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-border/70 px-3 text-label font-medium whitespace-nowrap shadow-sm backdrop-blur transition-colors";

export const CHROME_PILL_INACTIVE_CLASS = "bg-sidebar text-foreground/55 hover:bg-background hover:text-foreground/75";

export const CHROME_PILL_ACTIVE_CLASS = "bg-background text-foreground/75";

/** Inline right-panel DiscreteTabs — matches header pill chrome. */
export const DISCRETE_TAB_INACTIVE_CLASS = `${CHROME_PILL_INACTIVE_CLASS} data-[state=inactive]:shadow-sm`;

export const DISCRETE_TAB_ACTIVE_CLASS = `${CHROME_PILL_ACTIVE_CLASS} data-[state=active]:shadow-sm`;

/** Chat shell header — above content row so tab tooltips can extend downward. */
export const CHAT_HEADER_LAYER_CLASS = "relative z-10 overflow-visible";

/** InputBar suggestion chips below the composer. */
export const SUGGESTION_LIST_CLASS = "!px-0 flex-col items-start gap-1.5";

export const SUGGESTION_ITEM_CLASS =
	"h-auto justify-start rounded-full border border-border/70 bg-background/80 px-3 py-1.5 text-foreground/65 shadow-sm transition-colors hover:border-border hover:bg-foreground/6 hover:text-foreground";

/** Mobile right-panel overlay sheet. */
export const PANEL_OVERLAY_CLASS =
	"h-full min-h-0 w-[min(360px,calc(100vw-1.5rem))] overflow-hidden rounded-md border border-border/70 bg-background/95 shadow-lg backdrop-blur";

/** Inner rows: 4px + 8px section padding = 12px outer (concentric). */
export const fleetPiRowSurface = cva("flex min-w-0 rounded-[4px] border", {
	variants: {
		tone: {
			default: "border-border/30 bg-background/30",
			muted: "border-border/20 bg-foreground/1.5",
			inset: "border-border/60 bg-foreground/2",
			dashed: "border-dashed border-border/25 bg-background/10",
		},
		padding: {
			sm: "p-2",
			md: "px-2.5 py-2",
			lg: "p-2.5",
		},
		interactive: {
			true: "transition-[border-color,background-color,box-shadow] duration-200 hover:border-border/45 hover:bg-foreground/2 hover:shadow-sm",
			lift: "transition-[border-color,background-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:border-border/45 hover:bg-foreground/3.5 hover:shadow-sm",
			false: "",
		},
	},
	defaultVariants: {
		tone: "default",
		padding: "sm",
		interactive: false,
	},
});
