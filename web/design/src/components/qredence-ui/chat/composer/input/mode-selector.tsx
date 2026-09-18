import { cn } from "@prime-agent/web-design/lib/utils";
import { Check } from "lucide-react";
import type { ComponentType } from "react";
import { memo, useCallback, useState } from "react";
import { ComposerSelectorTrigger } from "./composer-selector-trigger";
import { Popover } from "./input-popover";

export type ModeOption = {
	id: string;
	label: string;
	icon?: ComponentType<{ className?: string }>;
	description?: string;
};

export type ModeSelectorProps = {
	modes: Array<ModeOption>;
	value?: string;
	defaultValue?: string;
	onChange?: (modeId: string) => void;
	className?: string;
};

export const ModeSelector = memo(function ModeSelector({
	modes,
	value,
	defaultValue,
	onChange,
	className,
}: ModeSelectorProps) {
	const isControlled = value !== undefined;
	const [internalValue, setInternalValue] = useState(defaultValue);
	const activeId = isControlled ? value : internalValue;
	const activeMode = modes.find((m) => m.id === activeId) ?? modes[0];
	const [open, setOpen] = useState(false);

	const handleSelect = useCallback(
		(id: string) => {
			if (!isControlled) setInternalValue(id);
			onChange?.(id);
			setOpen(false);
		},
		[isControlled, onChange],
	);

	if (modes.length === 0) return null;
	const ActiveIcon = activeMode?.icon;
	const hasMultiple = modes.length > 1;

	const modeLabel = activeMode?.label ?? "";
	const trigger = (
		<ComposerSelectorTrigger
			ariaLabel={modeLabel ? `Select mode, ${modeLabel}` : "Select mode"}
			label={modeLabel}
			leadingIcon={ActiveIcon ? <ActiveIcon className="size-3.5 shrink-0" /> : undefined}
			open={open}
			showChevron={hasMultiple}
			interactive={hasMultiple}
			className={className}
		/>
	);

	if (!hasMultiple) return trigger;

	return (
		<Popover open={open} onOpenChange={setOpen} side="top" align="start" trigger={trigger}>
			<div role="menu" aria-label="Select mode">
				{modes.map((mode) => {
					const isActive = mode.id === activeMode?.id;
					const Icon = mode.icon;
					return (
						<button
							key={mode.id}
							type="button"
							role="menuitemradio"
							aria-checked={isActive}
							onClick={() => handleSelect(mode.id)}
							className={cn(
								"flex w-full cursor-pointer items-start gap-2 rounded-[6px] px-2 py-2 text-left text-label leading-4 text-foreground transition-[background-color,transform] duration-150 hover:bg-foreground/6 active:scale-[0.96]",
								isActive && "bg-foreground/6",
							)}
						>
							{Icon ? (
								<span aria-hidden="true" className="mt-0.5 shrink-0">
									<Icon className="size-3.5" />
								</span>
							) : null}
							<span className="min-w-0 flex-1">
								<span className="block truncate font-medium">{mode.label}</span>
								{mode.description ? (
									<span className="block truncate text-foreground/70">{mode.description}</span>
								) : null}
							</span>
							{isActive ? (
								<Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-foreground/60" />
							) : null}
						</button>
					);
				})}
			</div>
		</Popover>
	);
});
