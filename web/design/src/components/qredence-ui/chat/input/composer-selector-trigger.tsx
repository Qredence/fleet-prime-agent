import { cn } from "@prime-agent/web-design/lib/utils";
import { ChevronDown } from "lucide-react";
import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from "react";

export const COMPOSER_SELECTOR_TRIGGER_CLASS =
	"relative inline-flex h-7 max-w-[18rem] min-w-0 cursor-pointer items-center gap-1.5 rounded-full px-2 text-label leading-4 text-foreground/40 transition-[background-color,transform] duration-150 after:absolute after:inset-x-0 after:-top-1.5 after:-bottom-1.5 hover:bg-foreground/6 hover:text-foreground/55 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96] data-[state=open]:bg-foreground/6 data-[state=open]:text-foreground/55";

export type ComposerSelectorTriggerProps = {
	label: ReactNode;
	leadingIcon?: ReactNode;
	suffix?: ReactNode;
	open?: boolean;
	showChevron?: boolean;
	interactive?: boolean;
	ariaLabel: string;
	combobox?: boolean;
	popupId?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">;

export const ComposerSelectorTrigger = forwardRef<HTMLButtonElement, ComposerSelectorTriggerProps>(
	function ComposerSelectorTrigger(
		{
			label,
			leadingIcon,
			suffix,
			open = false,
			showChevron = true,
			interactive = true,
			ariaLabel,
			combobox = false,
			popupId,
			className,
			type = "button",
			...rest
		},
		ref,
	) {
		return (
			<button
				ref={ref}
				type={type}
				data-state={open ? "open" : "closed"}
				role={combobox ? "combobox" : undefined}
				aria-haspopup={combobox ? "dialog" : undefined}
				aria-label={ariaLabel}
				aria-controls={combobox ? popupId : undefined}
				aria-expanded={combobox ? open : undefined}
				className={cn(COMPOSER_SELECTOR_TRIGGER_CLASS, !interactive && "pointer-events-none", className)}
				{...rest}
			>
				{leadingIcon ? <span className="shrink-0 [&_svg]:size-3.5">{leadingIcon}</span> : null}
				<span className="min-w-0 truncate font-medium">{label}</span>
				{suffix}
				{showChevron ? <ChevronDown aria-hidden="true" className="size-3 shrink-0 text-foreground/40" /> : null}
			</button>
		);
	},
);
