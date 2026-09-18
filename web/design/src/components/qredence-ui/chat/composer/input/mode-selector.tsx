import { cn } from "@prime-agent/web-design/lib/utils";
import { Check } from "lucide-react";
import type { ComponentType, KeyboardEvent } from "react";
import { memo, useCallback, useId, useRef, useState } from "react";
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
	const popupId = useId();
	const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

	const commitMode = useCallback(
		(id: string, close: boolean) => {
			if (!isControlled) setInternalValue(id);
			onChange?.(id);
			if (close) setOpen(false);
		},
		[isControlled, onChange],
	);

	const focusAndSelect = useCallback(
		(index: number) => {
			if (modes.length === 0) return;
			const clamped = ((index % modes.length) + modes.length) % modes.length;
			const mode = modes[clamped];
			if (!mode) return;
			optionRefs.current[clamped]?.focus();
			commitMode(mode.id, false);
		},
		[commitMode, modes],
	);

	const handleOptionKeyDown = useCallback(
		(event: KeyboardEvent<HTMLButtonElement>, modeId: string) => {
			if (modes.length === 0) return;
			const currentIndex = Math.max(
				0,
				modes.findIndex((mode) => mode.id === modeId),
			);

			switch (event.key) {
				case "ArrowDown":
				case "ArrowRight":
					event.preventDefault();
					focusAndSelect(currentIndex + 1);
					break;
				case "ArrowUp":
				case "ArrowLeft":
					event.preventDefault();
					focusAndSelect(currentIndex - 1);
					break;
				case "Home":
					event.preventDefault();
					focusAndSelect(0);
					break;
				case "End":
					event.preventDefault();
					focusAndSelect(modes.length - 1);
					break;
				default:
					break;
			}
		},
		[focusAndSelect, modes],
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
			aria-haspopup={hasMultiple ? "dialog" : undefined}
			aria-expanded={hasMultiple ? open : undefined}
			aria-controls={hasMultiple ? popupId : undefined}
			className={className}
		/>
	);

	if (!hasMultiple) return trigger;

	return (
		<Popover contentId={popupId} open={open} onOpenChange={setOpen} side="top" align="start" trigger={trigger}>
			{open ? (
				<div role="radiogroup" aria-label="Select mode" className="flex flex-col gap-0.5">
					{modes.map((mode, index) => {
						const isActive = mode.id === activeMode?.id;
						const Icon = mode.icon;
						return (
							<button
								key={mode.id}
								ref={(element) => {
									optionRefs.current[index] = element;
								}}
								type="button"
								role="radio"
								aria-checked={isActive}
								tabIndex={isActive ? 0 : -1}
								data-mode-id={mode.id}
								onClick={() => commitMode(mode.id, true)}
								onKeyDown={(event) => handleOptionKeyDown(event, mode.id)}
								className={cn(
									"flex w-full cursor-pointer items-start gap-2 rounded-[6px] px-2 py-2 text-start text-label leading-4 text-foreground transition-[background-color,transform] duration-150 hover:bg-foreground/6 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96]",
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
			) : null}
		</Popover>
	);
});
