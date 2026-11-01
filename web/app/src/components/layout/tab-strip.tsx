import type { LucideIcon } from "lucide-react";
import { Plus, X } from "lucide-react";
import { HIT_AREA_EXPAND_DENSE_CLASS } from "@/components/layout/tokens";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export type TabStripItem = {
	id: string;
	label: string;
	/** Leading icon. Omit it when `dotClassName` marks the tab status instead. */
	icon?: LucideIcon;
	/** Optional count rendered beside the icon. */
	badge?: number;
	/** Status dot classes. Only used when `icon` is absent. */
	dotClassName?: string;
	/** Appended to the accessible name, for example `streaming`. */
	statusLabel?: string;
	/** Overrides the accessible name derived from `label` and `statusLabel`. */
	ariaLabel?: string;
	/** Renders a close control when `onClose` is also provided. */
	closable?: boolean;
};

export type TabStripProps = {
	tabs: Array<TabStripItem>;
	value: string | null;
	/** Called on tab selection, including a re-press of the active tab. */
	onValueChange: (tabId: string) => void;
	onClose?: (tabId: string) => void;
	onNewSession?: () => void;
	ariaLabel?: string;
	/** `fill` splits the available width evenly; `fit` sizes to content. */
	width?: "fill" | "fit";
	/** `compact` tightens padding and gaps. */
	density?: "default" | "compact";
	/** Prefix for the tab trigger and controlled panel IDs. */
	idPrefix?: string;
	className?: string;
	dataTestid?: string;
};

/**
 * Renders one tab strip on the shared `ui/tabs` primitive.
 *
 * Roving focus, arrow/Home/End navigation, and `aria-selected` come from Base
 * UI. This component owns the Fleet presentation, the optional per-tab close
 * control, and the trailing new-session control.
 *
 * @param tabs - Tabs to render
 * @param value - The selected tab ID, or `null` when no tab is active
 * @param onValueChange - Called when a tab is selected, including a re-press
 * @param onClose - Called with a tab ID when its close control is pressed
 * @param onNewSession - Renders a trailing new-session control when provided
 * @param ariaLabel - Accessible name for the tab list
 * @param width - Fills the available width or sizes to content
 * @param density - Default or tightened spacing
 * @param idPrefix - Prefix for the tab trigger and controlled panel IDs
 * @param className - Additional wrapper classes
 * @param dataTestid - Test ID for the tab list wrapper
 */
export function TabStrip({
	tabs,
	value,
	onValueChange,
	onClose,
	onNewSession,
	ariaLabel = "Tabs",
	width = "fill",
	density = "default",
	idPrefix,
	className,
	dataTestid,
}: TabStripProps) {
	const compact = density === "compact";
	const fill = width === "fill";

	return (
		<div
			className={cn("flex min-w-0 max-w-full items-center", compact ? "gap-0.5" : "gap-1", className)}
			data-testid={dataTestid}
		>
			<Tabs
				className={cn("!flex-row !gap-0 min-w-0", fill ? "flex-1" : "w-fit")}
				onValueChange={(next) => {
					if (typeof next === "string") onValueChange(next);
				}}
				value={value}
			>
				<TabsList
					aria-label={ariaLabel}
					activateOnFocus
					className={cn(
						"!h-auto !w-fit !max-w-full !justify-start !rounded-none !bg-transparent !p-0",
						fill ? "min-w-0 flex-1" : "flex-none",
						compact ? "!gap-0.5" : "!gap-1",
						"overflow-x-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
					)}
					variant="line"
				>
					{tabs.map((tab) => {
						const active = tab.id === value;
						const Icon = tab.icon;
						const accessibleName =
							tab.ariaLabel ?? (tab.statusLabel ? `${tab.label}, ${tab.statusLabel}` : tab.label);
						const tabId = idPrefix ? `${idPrefix}-${encodeURIComponent(tab.id)}` : undefined;
						const panelId = idPrefix ? `${idPrefix}-panel-${encodeURIComponent(tab.id)}` : undefined;
						return (
							<div
								key={tab.id}
								className={cn(
									"group/tab relative",
									fill ? "min-w-0 max-w-[164px] flex-1 basis-[164px]" : "shrink-0",
								)}
								data-tab-id={tab.id}
							>
								<TabsTrigger
									aria-controls={panelId}
									aria-label={accessibleName}
									className={cn(
										"h-7 w-full min-w-0 justify-start text-start text-label font-medium leading-none",
										"rounded-[7px] !shadow-none after:hidden",
										compact ? "gap-0.5 !px-1.5" : "gap-1.5 !px-2",
										// The `ui/tabs` data-active variants outrank plain utilities,
										// so state colors have to be important to win.
										active
											? "!bg-surface-4 !text-foreground"
											: "!bg-transparent !text-foreground/45 hover:!bg-foreground/5 hover:!text-foreground/75",
										tab.closable && onClose && "pe-7",
									)}
									id={tabId}
									onClick={() => {
										// Base UI ignores a press on the active tab. Re-fire so callers
										// that toggle on re-select keep working.
										if (active) onValueChange(tab.id);
									}}
									value={tab.id}
								>
									{Icon ? (
										<span className={cn("flex shrink-0 items-center", compact ? "gap-0.5" : "gap-1")}>
											<Icon aria-hidden="true" className="size-3.5 shrink-0" />
											{tab.badge !== undefined ? (
												<span className="text-caption tabular-nums">{tab.badge}</span>
											) : null}
										</span>
									) : tab.dotClassName ? (
										<span
											aria-hidden="true"
											className={cn("size-1.5 shrink-0 rounded-full", tab.dotClassName)}
										/>
									) : null}
									<span className="min-w-0 flex-1 truncate text-start">{tab.label}</span>
								</TabsTrigger>
								{tab.closable && onClose ? (
									<Button
										aria-label={`Close ${tab.label} tab`}
										className="absolute top-1/2 left-auto size-5 -translate-y-1/2 rounded-[5px] p-0 text-foreground/35 opacity-0 transition-opacity motion-reduce:transition-none hover:bg-foreground/10 hover:text-foreground/75 focus-visible:opacity-100 group-hover/tab:opacity-100 [inset-inline-start:auto] [inset-inline-end:0.25rem]"
										onClick={(event) => {
											event.stopPropagation();
											onClose(tab.id);
										}}
										size="icon-compact"
										title={`Close ${tab.label} tab`}
										type="button"
										variant="ghost"
									>
										<X aria-hidden="true" className="size-3" />
									</Button>
								) : null}
							</div>
						);
					})}
				</TabsList>
			</Tabs>
			{onNewSession ? (
				<Button
					aria-label="New chat"
					className={cn(
						HIT_AREA_EXPAND_DENSE_CLASS,
						"relative z-10 size-7 shrink-0 rounded-[7px] text-foreground/50 hover:bg-foreground/7 hover:text-foreground/85",
					)}
					data-testid="new-chat-tab"
					onClick={(event) => {
						event.preventDefault();
						event.stopPropagation();
						onNewSession();
					}}
					size="icon-compact"
					title="New chat"
					type="button"
					variant="ghost"
				>
					<Plus aria-hidden="true" className="size-3.5" />
				</Button>
			) : null}
		</div>
	);
}
