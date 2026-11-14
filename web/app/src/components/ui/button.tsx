"use client";

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import {
	type ButtonHTMLAttributes,
	cloneElement,
	type CSSProperties,
	forwardRef,
	isValidElement,
	type ReactElement,
	type ReactNode,
	type Ref,
} from "react";
import type { IconComponent } from "@/lib/fluid/icon-context";
import { omit } from "@/lib/fluid/omit";
import { useShape } from "@/lib/fluid/shape-context";
import { useSizeVariant } from "@/lib/fluid/size-context";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
	[
		// whitespace-nowrap: a label never breaks onto 2 lines. It also makes
		// the label the button's narrowest width, so a tight row moves the
		// button (or overflows) instead of squeezing it.
		"group relative isolate inline-flex items-center justify-center outline-none cursor-pointer select-none whitespace-nowrap",
		"transition-colors duration-80",
		// A loading button is disabled too, but stays at full strength: aria-busy
		// marks it as working, not unavailable.
		"disabled:not-aria-busy:opacity-50 disabled:pointer-events-none",
		"focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
	],
	{
		variants: {
			variant: {
				primary: "text-background",
				default: "text-background",
				secondary: "text-foreground",
				tertiary: "text-foreground",
				outline: "text-foreground",
				ghost: "text-muted-foreground hover:text-foreground",
				link: "text-foreground underline-offset-4 hover:underline",
				// Tailwind reds, with their values as fallbacks for projects that
				// haven't emitted them. A red-500 wash in both themes under a
				// red-700 label (light) or a red-400 label (dark).
				destructive:
					"[color-scheme:light] dark:[color-scheme:dark] [--btn-red:var(--color-red-500,oklch(63.7%_0.237_25.331))] text-[color:light-dark(var(--color-red-700,oklch(50.5%_0.213_27.518)),var(--color-red-400,oklch(70.4%_0.191_22.216)))]",
			},
			// The two-step size ladder shared by every control:
			// default = 36px control height, compact = 28px for dense surfaces.
			size: {
				default:
					"h-9 px-4 text-[length:var(--fs-body,13px)] leading-[var(--lh-body,20px)] gap-1.5 [&_svg:not([class*='size-'])]:size-4",
				compact:
					"h-7 px-3 text-[length:var(--fs-body-compact,12px)] leading-[var(--lh-body-compact,18px)] gap-1 [&_svg:not([class*='size-'])]:size-3.5",
				icon: "h-9 w-9 p-0 [&_svg:not([class*='size-'])]:size-4 [&_svg]:h-4 [&_svg]:w-4",
				"icon-compact": "h-7 w-7 p-0 [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:h-3.5 [&_svg]:w-3.5",
			},
			iconLeft: { true: "" },
			iconRight: { true: "" },
		},
		// An icon sits 4px closer to its edge than text does: 12px default and
		// 8px compact, against the 16px / 12px base padding.
		compoundVariants: [
			{ size: "compact", iconLeft: true, className: "pl-2" },
			{ size: "default", iconLeft: true, className: "pl-3" },
			{ size: "compact", iconRight: true, className: "pr-2" },
			{ size: "default", iconRight: true, className: "pr-3" },
		],
		defaultVariants: {
			variant: "primary",
			size: "default",
		},
	},
);

type ButtonSizeCanonical = "default" | "compact" | "icon" | "icon-compact";

/** Public size values: the canonical two-size scale plus legacy aliases kept so
 *  existing call sites keep compiling (xs/sm -> compact; md/lg -> default). */
type ButtonSize = ButtonSizeCanonical | "xs" | "sm" | "md" | "lg" | "icon-xs" | "icon-sm" | "icon-lg";

const legacySizeAliases: Partial<Record<ButtonSize, ButtonSizeCanonical>> = {
	xs: "compact",
	sm: "compact",
	md: "default",
	lg: "default",
	"icon-xs": "icon-compact",
	"icon-sm": "icon-compact",
	"icon-lg": "icon",
};

const variantAliases: Record<NonNullable<VariantProps<typeof buttonVariants>["variant"]>, string> = {
	primary: "primary",
	default: "primary",
	secondary: "secondary",
	tertiary: "tertiary",
	outline: "tertiary",
	ghost: "ghost",
	link: "link",
	destructive: "destructive",
};

interface ButtonProps
	extends ButtonHTMLAttributes<HTMLButtonElement>, Omit<VariantProps<typeof buttonVariants>, "size"> {
	/** Omitted, the button follows the surrounding SizeProvider (default 36px,
	 *  compact 28px). Legacy xs/sm/md/lg values still resolve. */
	size?: ButtonSize;
	/** When true, the given single React-element child becomes the rendered element (slot-style). */
	asChild?: boolean;
	/** Base UI's spelling of `asChild`: the element to render as, with the
	 *  button's children as its label. */
	render?: ReactElement;
	/** Accepted for Base UI parity and ignored: the button already knows
	 *  whether it renders a native button. */
	nativeButton?: boolean;
	loading?: boolean;
	leadingIcon?: IconComponent;
	trailingIcon?: IconComponent;
	/** Force the visual pressed/held state when the button drives an external popup. */
	active?: boolean;
}

/* Press effect: the surface layer sits 1px inside the button and a
   same-color box-shadow spread fills it back out to the full bounds.
   Pressing collapses the spread, shrinking the surface by 1px per side. */
const bgVariants: Record<string, string> = {
	primary:
		"[--btn-bg:var(--foreground)] group-hover:[--btn-bg:color-mix(in_oklab,var(--foreground)_90%,var(--background))] group-active:[--btn-bg:color-mix(in_oklab,var(--foreground)_80%,var(--background))] bg-[var(--btn-bg)] shadow-[0_0_0_1px_var(--btn-bg)] group-active:shadow-[0_0_0_0px_var(--btn-bg)]",
	secondary:
		"[--btn-bg:var(--tint)] group-hover:[--btn-bg:var(--tint-hover)] group-active:[--btn-bg:var(--tint)] bg-[var(--btn-bg)] shadow-[0_0_0_1px_var(--btn-bg)] group-active:shadow-[0_0_0_0px_var(--btn-bg)]",
	tertiary:
		"bg-transparent shadow-[0_0_0_1px_var(--border),inset_0_0_0_0px_var(--border)] group-hover:bg-hover group-active:bg-active group-active:shadow-[0_0_0_0px_var(--border),inset_0_0_0_1px_var(--border)]",
	ghost: "bg-transparent shadow-[0_0_0_1px_transparent] group-hover:bg-hover group-hover:shadow-[0_0_0_1px_var(--hover)] group-active:bg-active group-active:shadow-[0_0_0_0px_var(--active)]",
	link: "bg-transparent shadow-none",
	destructive:
		"[--btn-bg:light-dark(color-mix(in_oklab,var(--btn-red)_15%,transparent),color-mix(in_oklab,var(--btn-red)_20%,transparent))] group-hover:[--btn-bg:light-dark(color-mix(in_oklab,var(--btn-red)_25%,transparent),color-mix(in_oklab,var(--btn-red)_30%,transparent))] group-active:[--btn-bg:light-dark(color-mix(in_oklab,var(--btn-red)_15%,transparent),color-mix(in_oklab,var(--btn-red)_20%,transparent))] bg-[var(--btn-bg)] shadow-[0_0_0_1px_var(--btn-bg)] group-active:shadow-[0_0_0_0px_var(--btn-bg)]",
};

const loadingBgVariants: Record<string, string> = Object.fromEntries(
	Object.entries(bgVariants).map(([variant, classes]) => [
		variant,
		classes
			.split(" ")
			.filter((c) => !c.startsWith("group-hover:") && !c.startsWith("group-active:"))
			.join(" "),
	]),
);

const activeBgVariants: Record<string, string> = {
	primary:
		"[--btn-bg:color-mix(in_oklab,var(--foreground)_80%,var(--background))] bg-[var(--btn-bg)] shadow-[0_0_0_1px_var(--btn-bg)] group-active:shadow-[0_0_0_0px_var(--btn-bg)]",
	secondary:
		"[--btn-bg:var(--tint)] bg-[var(--btn-bg)] shadow-[0_0_0_1px_var(--btn-bg)] group-active:shadow-[0_0_0_0px_var(--btn-bg)]",
	tertiary:
		"bg-active shadow-[0_0_0_1px_var(--border),inset_0_0_0_0px_var(--border)] group-active:shadow-[0_0_0_0px_var(--border),inset_0_0_0_1px_var(--border)]",
	ghost: "bg-active shadow-[0_0_0_1px_var(--active)] group-active:shadow-[0_0_0_0px_var(--active)]",
	link: "bg-transparent shadow-none underline",
	destructive:
		"[--btn-bg:light-dark(color-mix(in_oklab,var(--btn-red)_25%,transparent),color-mix(in_oklab,var(--btn-red)_30%,transparent))] bg-[var(--btn-bg)] shadow-[0_0_0_1px_var(--btn-bg)] group-active:shadow-[0_0_0_0px_var(--btn-bg)]",
};

type SlotElementProps = {
	children?: ReactNode;
	className?: string;
	style?: CSSProperties;
	ref?: Ref<HTMLButtonElement>;
} & Record<string, unknown>;

const ButtonSlot = forwardRef<
	HTMLButtonElement,
	ButtonHTMLAttributes<HTMLButtonElement> & {
		renderElement: ReactElement<SlotElementProps>;
		slotContent: ReactNode;
	}
>(({ renderElement, slotContent, ...props }, ref) =>
	useRender({
		render: cloneElement(renderElement, undefined, slotContent),
		ref,
		props: {
			...props,
			"data-slot": "button",
		},
	}),
);
ButtonSlot.displayName = "ButtonSlot";

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
	(
		{
			className,
			variant,
			size,
			asChild = false,
			render,
			loading = false,
			leadingIcon: LeadingIcon,
			trailingIcon: TrailingIcon,
			active = false,
			disabled,
			children,
			style,
			...rest
		},
		ref,
	) => {
		const props = omit(rest, ["nativeButton"]);
		const asChildElement =
			render && isValidElement(render)
				? children === undefined
					? (render as ReactElement<SlotElementProps>)
					: cloneElement(render as ReactElement<SlotElementProps>, undefined, children)
				: asChild && isValidElement(children)
					? (children as ReactElement<SlotElementProps>)
					: null;
		const label = asChildElement ? asChildElement.props.children : children;

		const contextSize = useSizeVariant();
		const resolvedSize: ButtonSizeCanonical = size
			? (legacySizeAliases[size] ?? (size as ButtonSizeCanonical))
			: contextSize === "compact"
				? "compact"
				: "default";
		const isIconOnly = resolvedSize === "icon" || resolvedSize === "icon-compact";
		const isCompact = resolvedSize === "compact" || resolvedSize === "icon-compact";
		const iconSize = isCompact ? 14 : 16;
		const shape = useShape();
		const resolvedVariant = variantAliases[variant ?? "primary"] ?? "primary";
		const bgClass = active
			? activeBgVariants[resolvedVariant]
			: loading
				? loadingBgVariants[resolvedVariant]
				: bgVariants[resolvedVariant];

		const labelNode =
			typeof label === "string" || typeof label === "number" ? (
				<span className="[text-box:trim-both_cap_alphabetic]">{label}</span>
			) : (
				<span className="inline-flex items-center gap-[inherit] [&_svg]:shrink-0">{label}</span>
			);

		const internals = (
			<>
				<span
					aria-hidden
					className={cn(
						"absolute inset-px rounded-[inherit] transition-[box-shadow,background-color] [transition-duration:180ms,80ms] [transition-timing-function:cubic-bezier(0.23,1,0.32,1),ease] group-active:[transition-duration:80ms,80ms]",
						bgClass,
					)}
				/>
				<span className="relative inline-flex items-center justify-center gap-[inherit]">
					{loading ? (
						<>
							<span className="flex items-center justify-center gap-[inherit] opacity-0">
								{LeadingIcon && !isIconOnly && <LeadingIcon size={iconSize} strokeWidth={2} />}
								{label}
								{TrailingIcon && !isIconOnly && <TrailingIcon size={iconSize} strokeWidth={2} />}
							</span>
							<span className="absolute inset-0 flex items-center justify-center">
								<svg width={iconSize} height={iconSize} viewBox="0 0 16 16" fill="none" aria-hidden="true">
									<g className="origin-center [transform-box:fill-box] animate-[spinner-turn_1s_cubic-bezier(0.65,0,0.35,1)_infinite] motion-reduce:[animation-duration:2s]">
										<circle
											cx="8"
											cy="8"
											r="6.25"
											stroke="currentColor"
											strokeWidth="1.5"
											strokeLinecap="round"
											pathLength="100"
											transform="rotate(-90 8 8)"
											className="animate-[spinner-breathe_1s_cubic-bezier(0.65,0,0.35,1)_infinite] motion-reduce:[animation-duration:2s]"
										/>
									</g>
								</svg>
							</span>
						</>
					) : isIconOnly ? (
						<span className="inline-flex items-center justify-center [&_svg]:shrink-0 [&_svg]:stroke-[1.5] [&_svg]:transition-[stroke-width] [&_svg]:duration-80 group-hover:[&_svg]:stroke-[2]">
							{label}
						</span>
					) : (
						<>
							{LeadingIcon && (
								<LeadingIcon
									size={iconSize}
									strokeWidth={1.5}
									className="shrink-0 transition-[stroke-width] duration-80 group-hover:stroke-[2]"
								/>
							)}
							{labelNode}
							{TrailingIcon && (
								<TrailingIcon
									size={iconSize}
									strokeWidth={1.5}
									className="shrink-0 transition-[stroke-width] duration-80 group-hover:stroke-[2]"
								/>
							)}
						</>
					)}
				</span>
			</>
		);

		const rootClassName = cn(
			buttonVariants({
				variant,
				size: resolvedSize,
				iconLeft: !isIconOnly && !!LeadingIcon,
				iconRight: !isIconOnly && !!TrailingIcon,
			}),
			shape.button,
			className,
		);

		if (asChildElement) {
			return (
				<ButtonSlot
					ref={ref}
					renderElement={asChildElement}
					slotContent={internals}
					className={rootClassName}
					disabled={disabled || loading}
					aria-busy={loading || undefined}
					style={style}
					{...props}
				/>
			);
		}

		return (
			<ButtonPrimitive
				ref={ref}
				data-slot="button"
				className={rootClassName}
				disabled={disabled || loading}
				aria-busy={loading || undefined}
				style={style}
				{...props}
			>
				{internals}
			</ButtonPrimitive>
		);
	},
);

Button.displayName = "Button";

export { Button, buttonVariants };
export type { ButtonProps, ButtonSize };
