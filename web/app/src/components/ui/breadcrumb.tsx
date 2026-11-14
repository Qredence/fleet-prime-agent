"use client";

import {
	type AnchorHTMLAttributes,
	type ButtonHTMLAttributes,
	Children,
	createContext,
	type CSSProperties,
	type ElementType,
	forwardRef,
	type HTMLAttributes,
	isValidElement,
	type LiHTMLAttributes,
	type OlHTMLAttributes,
	type ReactElement,
	type ReactNode,
	type Ref,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { FluidHoverHighlight } from "@/components/ui/fluid-hover-highlight";
import { useFluidHover } from "@/hooks/use-fluid-hover";
import { fontWeights } from "@/lib/fluid/font-weight";
import { useIcons } from "@/lib/fluid/icon-context";
import { useShape } from "@/lib/fluid/shape-context";
import { SizeProvider, type SizeVariant, useSize } from "@/lib/fluid/size-context";
import { cn } from "@/lib/utils";

const TARGET_ATTR = "data-breadcrumb-target";

function wrapLabels(children: ReactNode): ReactNode {
	return Children.map(children, (child) =>
		typeof child === "string" || typeof child === "number" ? (
			<span data-slot="breadcrumb-label" className="min-w-0 truncate">
				{child}
			</span>
		) : (
			child
		),
	);
}

type SlotProps = {
	className?: string;
	style?: CSSProperties;
	children?: ReactNode;
} & Record<string, unknown>;

function assignRef<T>(target: Ref<T> | undefined, node: T | null) {
	if (typeof target === "function") target(node);
	else if (target) (target as React.RefObject<T | null>).current = node;
}

function mergeSlotProps(inner: SlotProps, outer: SlotProps): SlotProps {
	const merged: SlotProps = {
		...inner,
		...outer,
		className: cn(inner.className, outer.className),
		style: { ...inner.style, ...(outer.style as CSSProperties | undefined) },
	};
	for (const key of Object.keys(inner)) {
		if (!/^on[A-Z]/.test(key)) continue;
		const a = inner[key];
		const b = outer[key];
		if (typeof a === "function" && typeof b === "function") {
			merged[key] = (...args: unknown[]) => {
				(b as (...x: unknown[]) => void)(...args);
				(a as (...x: unknown[]) => void)(...args);
			};
		}
	}
	return merged;
}

interface SlotOwnProps {
	trailing?: ReactNode;
	render?: ReactElement;
	asChild?: boolean;
	defaultTag: ElementType;
	elementRef?: Ref<HTMLElement>;
	props: SlotProps;
	children?: ReactNode;
	[key: string]: unknown;
}

const Slot = forwardRef<HTMLElement, Record<string, unknown>>(function Slot(rawProps, outerRef): ReactElement {
	const {
		render,
		asChild,
		defaultTag: DefaultTag,
		elementRef,
		props: ownProps,
		trailing,
		children,
		...extra
	} = rawProps as SlotOwnProps;
	const props = mergeSlotProps(ownProps, extra as SlotProps);
	let template: ReactElement<SlotProps> | null = null;
	let content = children;
	if (render && isValidElement(render)) {
		template = render as ReactElement<SlotProps>;
	} else if (asChild) {
		const only = Children.toArray(children)[0];
		if (isValidElement(only)) {
			template = only as ReactElement<SlotProps>;
			content = (only.props as SlotProps).children;
		}
	}
	const ownRef = (node: HTMLElement | null) => {
		assignRef(elementRef, node);
		assignRef(outerRef, node);
	};
	if (!template) {
		return (
			<DefaultTag {...props} ref={ownRef}>
				{wrapLabels(children)}
				{trailing}
			</DefaultTag>
		);
	}
	const Tag = template.type as ElementType;
	const theirs = template.props;
	const merged = mergeSlotProps(props, theirs);
	const templateRef = (theirs as { ref?: Ref<HTMLElement> }).ref;
	const composedRef = (node: HTMLElement | null) => {
		ownRef(node);
		assignRef(templateRef, node);
	};
	return (
		<Tag {...merged} ref={composedRef}>
			{wrapLabels(content ?? theirs.children)}
			{trailing}
		</Tag>
	);
});

interface BreadcrumbProps extends HTMLAttributes<HTMLElement> {
	/** Pins the trail to one step of the size ladder ("default" or "compact"). */
	size?: SizeVariant;
	/** Custom trailing glyph for each crumb. Pass `null` to omit. */
	separator?: ReactNode;
}

const SeparatorContext = createContext<ReactNode>(undefined);

const Breadcrumb = forwardRef<HTMLElement, BreadcrumbProps>(
	({ className, size, separator, children, onMouseMove, onMouseEnter, onMouseLeave, onClick, ...props }, ref) => {
		const navRef = useRef<HTMLElement | null>(null);
		const shape = useShape();
		const hover = useFluidHover(navRef, { axis: "xy", gapClick: false });
		const { registerItem } = hover;
		const registered = useRef<HTMLElement[]>([]);

		useLayoutEffect(() => {
			const nav = navRef.current;
			if (!nav) return;
			const next = Array.from(nav.querySelectorAll<HTMLElement>(`[${TARGET_ATTR}]`));
			const previous = registered.current;
			for (let i = next.length; i < previous.length; i++) registerItem(i, null);
			next.forEach((element, i) => {
				if (previous[i] !== element) registerItem(i, element);
			});
			registered.current = next;
		});

		const setRef = useCallback(
			(node: HTMLElement | null) => {
				navRef.current = node;
				assignRef(ref, node);
			},
			[ref],
		);

		const nav = (
			<nav
				ref={setRef}
				aria-label="Breadcrumb"
				data-slot="breadcrumb"
				className={cn("relative", className)}
				{...props}
				onMouseMove={(e) => {
					onMouseMove?.(e);
					hover.handlers.onMouseMove(e);
				}}
				onMouseEnter={(e) => {
					onMouseEnter?.(e);
					hover.handlers.onMouseEnter();
				}}
				onMouseLeave={(e) => {
					onMouseLeave?.(e);
					hover.handlers.onMouseLeave();
				}}
				onClick={(e) => {
					onClick?.(e);
					hover.handlers.onClick(e);
				}}
			>
				<FluidHoverHighlight hover={hover} className={shape.bg} />
				<SeparatorContext.Provider value={separator}>{children}</SeparatorContext.Provider>
			</nav>
		);
		return size ? <SizeProvider size={size}>{nav}</SizeProvider> : nav;
	},
);
Breadcrumb.displayName = "Breadcrumb";

const BreadcrumbList = forwardRef<HTMLOListElement, OlHTMLAttributes<HTMLOListElement>>(
	({ className, ...props }, ref) => {
		const sizeClasses = useSize();
		return (
			<ol
				ref={ref}
				data-slot="breadcrumb-list"
				className={cn("flex min-w-0 flex-nowrap items-center text-muted-foreground", sizeClasses.text, className)}
				{...props}
			/>
		);
	},
);
BreadcrumbList.displayName = "BreadcrumbList";

const BreadcrumbItem = forwardRef<HTMLLIElement, LiHTMLAttributes<HTMLLIElement>>(({ className, ...props }, ref) => (
	<li
		ref={ref}
		data-slot="breadcrumb-item"
		className={cn("inline-flex min-w-0 shrink-0 items-center has-[[data-slot=breadcrumb-page]]:shrink", className)}
		{...props}
	/>
));
BreadcrumbItem.displayName = "BreadcrumbItem";

const BreadcrumbSeparator = forwardRef<HTMLLIElement, LiHTMLAttributes<HTMLLIElement>>(
	({ children, className, ...props }, ref) => {
		const custom = useContext(SeparatorContext);
		const icons = useIcons();
		const sizeClasses = useSize();
		const ChevronRight = icons["chevron-right"];
		return (
			<li
				ref={ref}
				role="presentation"
				aria-hidden="true"
				data-slot="breadcrumb-separator"
				className={cn(
					"inline-flex select-none items-center justify-center px-1 text-muted-foreground",
					sizeClasses.variant === "compact" ? "[&>svg]:size-3" : "[&>svg]:size-3.5",
					className,
				)}
				{...props}
			>
				{children ?? (custom !== undefined ? custom : <ChevronRight size={sizeClasses.icon - 2} />)}
			</li>
		);
	},
);
BreadcrumbSeparator.displayName = "BreadcrumbSeparator";

function textOf(children: ReactNode): string | undefined {
	const parts: string[] = [];
	Children.forEach(children, (child) => {
		if (typeof child === "string" || typeof child === "number") parts.push(String(child));
	});
	const text = parts.join("").trim();
	return text || undefined;
}

function useCutLabel() {
	const [cut, setCut] = useState(false);
	const check = useCallback((crumb: HTMLElement) => {
		const label = crumb.querySelector<HTMLElement>("[data-slot=breadcrumb-label]");
		setCut(!!label && label.scrollWidth > label.clientWidth + 0.5);
	}, []);
	return { cut, check };
}

function useCrumbClasses() {
	const shape = useShape();
	const sizeClasses = useSize();
	const compact = sizeClasses.variant === "compact";
	return cn(
		"relative inline-flex min-w-0 shrink-0 items-center whitespace-nowrap",
		sizeClasses.segmentItem,
		sizeClasses.itemPx,
		compact ? "gap-1" : "gap-1.5",
		compact
			? "[li:not(:last-child)_&]:has-[>[data-slot=breadcrumb-separator]]:pr-1"
			: "[li:not(:last-child)_&]:has-[>[data-slot=breadcrumb-separator]]:pr-1.5",
		compact
			? "[&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5"
			: "[&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
		shape.item,
	);
}

function useTargetClasses() {
	const compact = useSize().variant === "compact";
	return cn(
		useCrumbClasses(),
		compact ? "max-w-40" : "max-w-48",
		"cursor-pointer text-muted-foreground outline-none transition-colors duration-80",
		"data-[fluid-hover-active]:text-foreground",
		"[&[aria-haspopup][data-state=open]]:text-foreground [&[aria-haspopup][data-popup-open]]:text-foreground",
		"focus-visible:text-foreground focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
		"disabled:pointer-events-none disabled:opacity-50",
	);
}

interface BreadcrumbLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
	/** Element to render instead of `<a>`. */
	render?: ReactElement;
	/** Composes props onto the single child element. */
	asChild?: boolean;
}

const BreadcrumbLink = forwardRef<HTMLAnchorElement, BreadcrumbLinkProps>(
	({ className, style, render, asChild, children, onPointerEnter, onFocus, ...props }, ref) => {
		const classes = useTargetClasses();
		const { cut, check } = useCutLabel();
		const text = textOf(
			asChild && isValidElement(children) ? (children.props as { children?: ReactNode }).children : children,
		);
		return (
			<Slot
				render={render}
				asChild={asChild}
				defaultTag="a"
				elementRef={ref as Ref<HTMLElement>}
				props={{
					...props,
					[TARGET_ATTR]: "",
					"data-slot": "breadcrumb-link",
					title: cut ? text : undefined,
					className: cn(classes, className),
					style: { fontVariationSettings: fontWeights.normal, ...style },
					onPointerEnter: (e: React.PointerEvent<HTMLAnchorElement>) => {
						onPointerEnter?.(e);
						check(e.currentTarget);
					},
					onFocus: (e: React.FocusEvent<HTMLAnchorElement>) => {
						onFocus?.(e);
						check(e.currentTarget);
					},
				}}
				trailing={<CrumbSeparator />}
			>
				{children}
			</Slot>
		);
	},
);
BreadcrumbLink.displayName = "BreadcrumbLink";

const BreadcrumbButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
	({ className, style, type = "button", children, onPointerEnter, onFocus, ...props }, ref) => {
		const classes = useTargetClasses();
		const { cut, check } = useCutLabel();
		const onlyEllipsis = isValidElement(children) && children.type === BreadcrumbEllipsis;
		return (
			<button
				ref={ref}
				type={type}
				{...{ [TARGET_ATTR]: "" }}
				data-slot="breadcrumb-button"
				title={cut ? textOf(children) : undefined}
				className={cn(classes, className)}
				style={{ fontVariationSettings: fontWeights.normal, ...style }}
				aria-label={onlyEllipsis ? "Show hidden steps" : undefined}
				{...props}
				onPointerEnter={(e) => {
					onPointerEnter?.(e);
					check(e.currentTarget);
				}}
				onFocus={(e) => {
					onFocus?.(e);
					check(e.currentTarget);
				}}
			>
				{wrapLabels(children)}
				<CrumbSeparator />
			</button>
		);
	},
);
BreadcrumbButton.displayName = "BreadcrumbButton";

const BreadcrumbPage = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(
	({ className, style, children, onPointerEnter, ...props }, ref) => {
		const classes = useCrumbClasses();
		const { cut, check } = useCutLabel();
		return (
			<span
				ref={ref}
				role="link"
				aria-disabled="true"
				aria-current="page"
				{...{ [TARGET_ATTR]: "" }}
				data-slot="breadcrumb-page"
				title={cut ? textOf(children) : undefined}
				className={cn(classes, "shrink cursor-default text-foreground", className)}
				style={{ fontVariationSettings: fontWeights.normal, ...style }}
				{...props}
				onPointerEnter={(e) => {
					onPointerEnter?.(e);
					check(e.currentTarget);
				}}
			>
				{wrapLabels(children)}
			</span>
		);
	},
);
BreadcrumbPage.displayName = "BreadcrumbPage";

function CrumbSeparator() {
	const custom = useContext(SeparatorContext);
	const icons = useIcons();
	const sizeClasses = useSize();
	if (custom === null) return null;
	const ChevronRight = icons["chevron-right"];
	const isDefault = custom === undefined;
	return (
		<span
			aria-hidden="true"
			data-slot="breadcrumb-separator"
			className={cn(
				"inline-flex select-none items-center justify-center text-muted-foreground",
				"[li:last-child_&]:hidden",
				sizeClasses.variant === "compact" ? "[&>svg]:!size-3" : "[&>svg]:!size-3.5",
				isDefault &&
					"transition-transform duration-150 ease-out motion-reduce:transition-none [[aria-haspopup][data-state=open]>&]:rotate-90 [[aria-haspopup][data-popup-open]>&]:rotate-90",
				isDefault &&
					"[[aria-haspopup][data-fluid-hover-active]>&]:rotate-90 [[aria-haspopup]:focus-visible>&]:rotate-90",
			)}
		>
			{isDefault ? <ChevronRight size={sizeClasses.icon - 2} /> : custom}
		</span>
	);
}

const BreadcrumbEllipsis = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(
	({ className, ...props }, ref) => {
		const icons = useIcons();
		const sizeClasses = useSize();
		const More = icons["more-horizontal"];
		return (
			<span
				ref={ref}
				role="presentation"
				data-slot="breadcrumb-ellipsis"
				className={cn("inline-flex items-center justify-center", className)}
				{...props}
			>
				<More size={sizeClasses.icon} />
				<span className="sr-only">More</span>
			</span>
		);
	},
);
BreadcrumbEllipsis.displayName = "BreadcrumbEllipsis";

function naturalWidth(item: HTMLElement) {
	let width = item.getBoundingClientRect().width;
	if (item.querySelector("[data-slot=breadcrumb-page]")) {
		item.querySelectorAll<HTMLElement>("[data-slot=breadcrumb-label]").forEach((label) => {
			width += label.scrollWidth - label.clientWidth;
		});
	}
	return width;
}

interface UseBreadcrumbCollapseOptions {
	/** Steps in the full trail, the current page included. */
	count: number;
	/** Off, nothing hides. */
	enabled?: boolean;
}

function useBreadcrumbCollapse({ count, enabled = true }: UseBreadcrumbCollapseOptions) {
	const listNode = useRef<HTMLOListElement | null>(null);
	const [list, setList] = useState<HTMLOListElement | null>(null);
	const listRef = useCallback((node: HTMLOListElement | null) => {
		listNode.current = node;
		setList(node);
	}, []);
	const widths = useRef<number[]>([]);
	const ellipsisWidth = useRef(0);
	const [hidden, setHidden] = useState(0);
	const [, setResized] = useState(0);

	// Re-measure after render so dynamically changing labels collapse cleanly.
	// oxlint-disable-next-line react-hooks/exhaustive-deps
	useLayoutEffect(() => {
		const ol = listNode.current;
		const nav = ol?.parentElement;
		if (!ol || !nav) return;
		const items = Array.from(ol.children).filter((child): child is HTMLElement =>
			child.matches("[data-slot=breadcrumb-item]"),
		);
		const isEllipsis = (item: HTMLElement) => !!item.querySelector("[data-slot=breadcrumb-ellipsis]");
		const steps = items.filter((item) => !isEllipsis(item));
		const ellipsis = items.find(isEllipsis);
		if (ellipsis) ellipsisWidth.current = naturalWidth(ellipsis);
		steps.forEach((item, i) => {
			const index = hidden > 0 && i > 0 ? i + hidden : i;
			if (index < count) widths.current[index] = naturalWidth(item);
		});

		let next = 0;
		if (enabled) {
			const available = nav.clientWidth;
			const width = (i: number) => widths.current[i] ?? 0;
			let total = 0;
			for (let i = 0; i < count; i++) total += width(i);
			const maxHidden = Math.max(0, count - 3);
			const ellipsisCost = ellipsisWidth.current || 44;
			if (total > available + 0.5) {
				let shown = total + ellipsisCost;
				while (next < maxHidden && shown > available + 0.5) {
					shown -= width(1 + next);
					next++;
				}
			}
		}
		if (next !== hidden) setHidden(next);
	});

	useEffect(() => {
		const nav = list?.parentElement;
		if (!nav || typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(() => setResized((n) => n + 1));
		ro.observe(nav);
		return () => ro.disconnect();
	}, [list]);

	return { listRef, hidden: enabled ? hidden : 0 };
}

export {
	Breadcrumb,
	BreadcrumbButton,
	BreadcrumbEllipsis,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
	useBreadcrumbCollapse,
};
export type { BreadcrumbLinkProps, BreadcrumbProps, UseBreadcrumbCollapseOptions };
export default Breadcrumb;
