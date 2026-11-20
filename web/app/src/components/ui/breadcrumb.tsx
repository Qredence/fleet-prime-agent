"use client";

import {
	Children,
	createContext,
	forwardRef,
	type HTMLAttributes,
	type LiHTMLAttributes,
	type OlHTMLAttributes,
	type ReactNode,
	type Ref,
	useCallback,
	useContext,
	useState,
} from "react";
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

function assignRef<T>(target: Ref<T> | undefined, node: T | null) {
	if (typeof target === "function") target(node);
	else if (target) (target as React.RefObject<T | null>).current = node;
}

interface BreadcrumbProps extends HTMLAttributes<HTMLElement> {
	/** Pins the trail to one step of the size ladder ("default" or "compact"). */
	size?: SizeVariant;
	/** Custom trailing glyph for each crumb. Pass `null` to omit. */
	separator?: ReactNode;
}

const SeparatorContext = createContext<ReactNode>(undefined);

const Breadcrumb = forwardRef<HTMLElement, BreadcrumbProps>(
	({ className, size, separator, children, onMouseMove, onMouseEnter, onMouseLeave, onClick, ...props }, ref) => {
		const setRef = useCallback(
			(node: HTMLElement | null) => {
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
				onMouseMove={onMouseMove}
				onMouseEnter={onMouseEnter}
				onMouseLeave={onMouseLeave}
				onClick={onClick}
			>
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

export { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator };
