"use client";

import { type HTMLMotionProps, m, useReducedMotion } from "motion/react";
import {
	type ButtonHTMLAttributes,
	type ComponentProps,
	type CSSProperties,
	createContext,
	forwardRef,
	type HTMLAttributes,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { EASE_DRAWER, EASE_OUT } from "@/lib/ease";
import { SESSION_SIDEBAR_WIDTH_CSS } from "@/lib/layout-constants";
import { cn } from "@/lib/utils";

type SidebarState = "expanded" | "collapsed";
type SidebarSide = "left" | "right";
type SidebarVariant = "sidebar" | "floating" | "inset";
type SidebarCollapsible = "offcanvas" | "icon" | "none";

const SIDEBAR_KEYBOARD_SHORTCUT = "b";

const PANEL_TRANSITION = {
	duration: 0.36,
	ease: EASE_DRAWER,
} as const;

// The desktop rail settles at a hard zero-width boundary. Keep the spring
// critically damped so it cannot overshoot, pause against that boundary, and
// then snap back during the final frame.
const SIDEBAR_MORPH_TRANSITION = {
	type: "spring",
	stiffness: 380,
	damping: 35,
	mass: 0.75,
} as const;

const REDUCED_TRANSITION = {
	duration: 0.16,
	ease: EASE_OUT,
} as const;

const FOCUSABLE_SELECTOR = [
	"a[href]",
	"button:not([disabled])",
	"input:not([disabled])",
	"select:not([disabled])",
	"textarea:not([disabled])",
	"[tabindex]:not([tabindex='-1'])",
].join(",");

interface AnimatedSidebarContextValue {
	isMobile: boolean;
	layoutId: string;
	open: boolean;
	openMobile: boolean;
	reduce: boolean;
	setOpen: (open: boolean) => void;
	setOpenMobile: (open: boolean) => void;
	state: SidebarState;
	toggleSidebar: () => void;
	triggerRef: React.RefObject<HTMLButtonElement | null>;
}

const AnimatedSidebarContext = createContext<AnimatedSidebarContextValue | null>(null);

interface AnimatedSidebarPanelContextValue {
	collapsed: boolean;
	collapsible: SidebarCollapsible;
	side: SidebarSide;
}

const AnimatedSidebarPanelContext = createContext<AnimatedSidebarPanelContextValue | null>(null);

function useAnimatedSidebar() {
	const context = useContext(AnimatedSidebarContext);
	if (!context) {
		throw new Error("useAnimatedSidebar must be used inside AnimatedSidebarProvider.");
	}
	return context;
}

function useAnimatedSidebarPanel() {
	const context = useContext(AnimatedSidebarPanelContext);
	if (!context) {
		throw new Error("Animated Sidebar parts must be used inside AnimatedSidebar.");
	}
	return context;
}

type SidebarProviderStyle = CSSProperties & {
	"--sidebar-width"?: string;
	"--sidebar-width-icon"?: string;
	"--sidebar-width-mobile"?: string;
};

export interface AnimatedSidebarProviderProps extends HTMLAttributes<HTMLDivElement> {
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
	openMobile?: boolean;
	defaultOpenMobile?: boolean;
	onOpenMobileChange?: (open: boolean) => void;
	style?: SidebarProviderStyle;
}

export function AnimatedSidebarProvider({
	children,
	open,
	defaultOpen = true,
	onOpenChange,
	openMobile,
	defaultOpenMobile = false,
	onOpenMobileChange,
	className,
	style,
	...props
}: AnimatedSidebarProviderProps) {
	const [internalOpen, setInternalOpen] = useState(defaultOpen);
	const [internalOpenMobile, setInternalOpenMobile] = useState(defaultOpenMobile);
	const isMobile = useIsMobile();
	const reduce = useReducedMotion() ?? false;
	const generatedId = useId();
	const triggerRef = useRef<HTMLButtonElement>(null);
	const desktopOpen = open ?? internalOpen;
	const mobileOpen = openMobile ?? internalOpenMobile;

	const setOpen = useCallback(
		(nextOpen: boolean) => {
			if (open === undefined) setInternalOpen(nextOpen);
			onOpenChange?.(nextOpen);
		},
		[onOpenChange, open],
	);

	const setOpenMobile = useCallback(
		(nextOpen: boolean) => {
			if (openMobile === undefined) setInternalOpenMobile(nextOpen);
			onOpenMobileChange?.(nextOpen);
		},
		[onOpenMobileChange, openMobile],
	);

	const toggleSidebar = useCallback(() => {
		if (isMobile) setOpenMobile(!mobileOpen);
		else setOpen(!desktopOpen);
	}, [desktopOpen, isMobile, mobileOpen, setOpen, setOpenMobile]);

	const sidebarContextValue: AnimatedSidebarContextValue = useMemo(
		() => ({
			isMobile,
			layoutId: `${generatedId}-active`,
			open: desktopOpen,
			openMobile: mobileOpen,
			reduce,
			setOpen,
			setOpenMobile,
			state: desktopOpen ? "expanded" : "collapsed",
			toggleSidebar,
			triggerRef,
		}),
		[desktopOpen, generatedId, isMobile, mobileOpen, reduce, setOpen, setOpenMobile, toggleSidebar],
	);

	useEffect(() => {
		const handleShortcut = (event: KeyboardEvent) => {
			if (event.key.toLowerCase() === SIDEBAR_KEYBOARD_SHORTCUT && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				toggleSidebar();
			}
		};

		window.addEventListener("keydown", handleShortcut);
		return () => window.removeEventListener("keydown", handleShortcut);
	}, [toggleSidebar]);

	return (
		<AnimatedSidebarContext.Provider value={sidebarContextValue}>
			<div
				{...props}
				data-slot="sidebar-wrapper"
				data-state={desktopOpen ? "expanded" : "collapsed"}
				style={{
					"--sidebar-width": "16rem",
					"--sidebar-width-icon": "4.25rem",
					"--sidebar-width-mobile": "18rem",
					...style,
				}}
				className={cn("group/sidebar-wrapper flex min-h-svh w-full min-w-0", className)}
			>
				{children}
			</div>
		</AnimatedSidebarContext.Provider>
	);
}

export type ChatAppProps = ComponentProps<typeof AnimatedSidebarProvider> & {
	sidebarWidth?: string;
};

/** Provides the animated sidebar layout with Fleet's shared default sidebar width. */
export function ChatApp({
	children,
	className,
	sidebarWidth = SESSION_SIDEBAR_WIDTH_CSS,
	style,
	...props
}: ChatAppProps) {
	return (
		<AnimatedSidebarProvider
			{...props}
			style={{ ...style, "--sidebar-width": sidebarWidth }}
			className={cn("min-h-0 w-full overflow-hidden rounded-2xl border border-border bg-background", className)}
		>
			{children}
		</AnimatedSidebarProvider>
	);
}

function MobileSidebar({
	ariaLabel,
	children,
	className,
	side,
}: {
	ariaLabel: string;
	children: ReactNode;
	className?: string;
	side: SidebarSide;
}) {
	const context = useAnimatedSidebar();
	const panelRef = useRef<HTMLDivElement>(null);
	const [mounted, setMounted] = useState(false);
	const mobilePanelContextValue = useMemo(() => ({ collapsed: false, collapsible: "none" as const, side }), [side]);

	useEffect(() => setMounted(true), []);

	useEffect(() => {
		if (!context.openMobile) return;

		const panel = panelRef.current;
		if (!panel) return;
		const trigger = context.triggerRef.current;
		const body = document.body;
		const scrollY = window.scrollY;
		const previousBodyStyles = {
			left: body.style.left,
			overflow: body.style.overflow,
			position: body.style.position,
			right: body.style.right,
			top: body.style.top,
		};

		body.style.position = "fixed";
		body.style.top = `-${scrollY}px`;
		body.style.left = "0";
		body.style.right = "0";
		body.style.overflow = "hidden";

		const focusFrame = requestAnimationFrame(() => {
			const firstFocusable = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
			(firstFocusable ?? panel).focus({ preventScroll: true });
		});

		return () => {
			cancelAnimationFrame(focusFrame);
			body.style.position = previousBodyStyles.position;
			body.style.top = previousBodyStyles.top;
			body.style.left = previousBodyStyles.left;
			body.style.right = previousBodyStyles.right;
			body.style.overflow = previousBodyStyles.overflow;
			window.scrollTo(0, scrollY);
			trigger?.focus({ preventScroll: true });
		};
	}, [context.openMobile, context.triggerRef, mounted]);

	if (!mounted) return null;

	return createPortal(
		<div
			className={cn(
				"pointer-events-none fixed inset-0 z-50 md:hidden",
				context.openMobile ? "visible" : "invisible",
			)}
		>
			<m.button
				type="button"
				aria-label="Close sidebar"
				tabIndex={context.openMobile ? 0 : -1}
				initial={false}
				animate={{ opacity: context.openMobile ? 1 : 0 }}
				transition={context.reduce ? REDUCED_TRANSITION : PANEL_TRANSITION}
				onClick={() => context.setOpenMobile(false)}
				className={cn(
					"absolute inset-0 bg-black/40",
					context.openMobile ? "pointer-events-auto" : "pointer-events-none",
				)}
			/>

			<m.div
				ref={panelRef}
				role="dialog"
				aria-modal="true"
				aria-label={ariaLabel}
				aria-hidden={!context.openMobile}
				inert={!context.openMobile}
				tabIndex={-1}
				data-mobile="true"
				data-state={context.openMobile ? "expanded" : "collapsed"}
				data-side={side}
				initial={false}
				animate={{
					opacity: context.reduce ? (context.openMobile ? 1 : 0) : 1,
					x: context.reduce ? 0 : context.openMobile ? "0%" : side === "left" ? "-100%" : "100%",
				}}
				transition={context.reduce ? REDUCED_TRANSITION : PANEL_TRANSITION}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						context.setOpenMobile(false);
						return;
					}

					if (event.key !== "Tab") return;
					const focusable = panelRef.current
						? Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
						: [];

					if (focusable.length === 0) {
						event.preventDefault();
						panelRef.current?.focus();
						return;
					}

					const first = focusable[0];
					const last = focusable[focusable.length - 1];
					if (event.shiftKey && document.activeElement === first) {
						event.preventDefault();
						last.focus();
					} else if (!event.shiftKey && document.activeElement === last) {
						event.preventDefault();
						first.focus();
					}
				}}
				className={cn(
					"pointer-events-auto absolute inset-y-0 flex h-dvh w-(--sidebar-width-mobile) max-w-[88vw] flex-col overflow-hidden",
					"border-border bg-background shadow-2xl will-change-transform",
					side === "left" ? "left-0 border-r" : "right-0 border-l",
					!context.openMobile && "pointer-events-none",
					className,
				)}
			>
				<AnimatedSidebarPanelContext.Provider value={mobilePanelContextValue}>
					{children}
				</AnimatedSidebarPanelContext.Provider>
			</m.div>
		</div>,
		document.body,
	);
}

export interface AnimatedSidebarProps extends Omit<HTMLMotionProps<"aside">, "children"> {
	children?: ReactNode;
	side?: SidebarSide;
	variant?: SidebarVariant;
	collapsible?: SidebarCollapsible;
	ariaLabel?: string;
	panelClassName?: string;
}

export const AnimatedSidebar = forwardRef<HTMLElement, AnimatedSidebarProps>(function AnimatedSidebar(
	{
		side = "left",
		variant = "sidebar",
		collapsible = "icon",
		ariaLabel = "Sidebar",
		children,
		className,
		panelClassName,
		style,
		...props
	},
	forwardedRef,
) {
	const context = useAnimatedSidebar();
	const collapsed = collapsible !== "none" && !context.open;
	const offcanvas = collapsed && collapsible === "offcanvas";
	const carded = variant === "floating" || variant === "inset";
	const width = offcanvas
		? "0px"
		: collapsed
			? carded
				? "calc(var(--sidebar-width-icon) + 1rem)"
				: "var(--sidebar-width-icon)"
			: carded
				? "calc(var(--sidebar-width) + 1rem)"
				: "var(--sidebar-width)";
	const panelContextValue = useMemo(() => ({ collapsed, collapsible, side }), [collapsed, collapsible, side]);

	if (context.isMobile) {
		return (
			<MobileSidebar ariaLabel={ariaLabel} className={className} side={side}>
				{children}
			</MobileSidebar>
		);
	}

	return (
		<m.aside
			{...props}
			ref={forwardedRef}
			initial={false}
			aria-label={ariaLabel}
			data-slot="sidebar"
			data-state={collapsed ? "collapsed" : "expanded"}
			data-collapsible={collapsible}
			data-variant={variant}
			data-side={side}
			transition={context.reduce ? { duration: 0 } : SIDEBAR_MORPH_TRANSITION}
			layout="size"
			style={{ ...style, width }}
			className={cn(
				"group/sidebar relative hidden h-auto shrink-0 md:block will-change-transform",
				"peer",
				side === "right" && "order-last",
				className,
			)}
		>
			<m.div
				initial={false}
				animate={{
					opacity: offcanvas ? 0 : 1,
					x: offcanvas ? (side === "left" ? "-120%" : "120%") : "0%",
				}}
				transition={context.reduce ? REDUCED_TRANSITION : PANEL_TRANSITION}
				className={cn(
					"sticky top-0 flex h-svh w-full flex-col overflow-hidden",
					carded && (collapsed ? "w-[var(--sidebar-width-icon)]" : "w-[var(--sidebar-width)]"),
					collapsible === "offcanvas" && "w-[var(--sidebar-width)]",
					variant === "sidebar" &&
						(side === "left" ? "border-border border-r bg-background" : "border-border border-l bg-background"),
					variant === "floating" && "m-2 h-[calc(100svh-1rem)] rounded-2xl bg-sidebar shadow-surface-3",
					variant === "inset" && "m-2 h-[calc(100svh-1rem)] rounded-2xl bg-background",
					panelClassName,
				)}
			>
				<AnimatedSidebarPanelContext.Provider value={panelContextValue}>
					{children}
				</AnimatedSidebarPanelContext.Provider>
			</m.div>
		</m.aside>
	);
});

export interface AnimatedSidebarTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {}

export const AnimatedSidebarTrigger = forwardRef<HTMLButtonElement, AnimatedSidebarTriggerProps>(
	function AnimatedSidebarTrigger({ className, onClick, type = "button", ...props }, forwardedRef) {
		const context = useAnimatedSidebar();
		const expanded = context.isMobile ? context.openMobile : context.open;

		return (
			<Button
				{...props}
				ref={(node) => {
					context.triggerRef.current = node;
					if (typeof forwardedRef === "function") forwardedRef(node);
					else if (forwardedRef) forwardedRef.current = node;
				}}
				type={type}
				variant="ghost"
				size="icon"
				aria-label={props["aria-label"] ?? "Toggle sidebar"}
				aria-expanded={expanded}
				data-slot="sidebar-trigger"
				data-state={expanded ? "expanded" : "collapsed"}
				onClick={(event) => {
					onClick?.(event);
					if (!event.defaultPrevented) context.toggleSidebar();
				}}
				className={cn(
					"focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
					className,
				)}
			/>
		);
	},
);

export interface AnimatedSidebarRailProps extends ButtonHTMLAttributes<HTMLButtonElement> {}

export const AnimatedSidebarRail = forwardRef<HTMLButtonElement, AnimatedSidebarRailProps>(function AnimatedSidebarRail(
	{ className, onClick, type = "button", ...props },
	forwardedRef,
) {
	const context = useAnimatedSidebar();
	const panel = useAnimatedSidebarPanel();

	return (
		<button
			{...props}
			ref={forwardedRef}
			type={type}
			data-side={panel.side}
			aria-label={props["aria-label"] ?? "Toggle sidebar"}
			title="Toggle sidebar"
			tabIndex={-1}
			onClick={(event) => {
				onClick?.(event);
				if (!event.defaultPrevented) context.toggleSidebar();
			}}
			className={cn(
				"absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 outline-none md:block",
				"after:absolute after:inset-y-0 after:left-1/2 after:w-px after:bg-transparent after:transition-colors hover:after:bg-border",
				"data-[side=right]:right-0 data-[side=right]:translate-x-1/2 data-[side=left]:left-full",
				className,
			)}
		/>
	);
});

export interface AnimatedSidebarInsetProps extends HTMLMotionProps<"main"> {}

export const AnimatedSidebarInset = forwardRef<HTMLElement, AnimatedSidebarInsetProps>(function AnimatedSidebarInset(
	{ className, ...props },
	forwardedRef,
) {
	return (
		<m.main
			{...props}
			ref={forwardedRef}
			data-slot="sidebar-inset"
			className={cn(
				"relative flex min-h-svh min-w-0 flex-1 flex-col bg-background",
				"md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-2xl md:peer-data-[variant=inset]:shadow-sm",
				className,
			)}
		/>
	);
});

export const AnimatedSidebarHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
	function AnimatedSidebarHeader({ className, ...props }, forwardedRef) {
		return (
			<div
				{...props}
				ref={forwardedRef}
				data-slot="sidebar-header"
				className={cn("flex shrink-0 flex-col gap-2 p-3", className)}
			/>
		);
	},
);

export const AnimatedSidebarContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
	function AnimatedSidebarContent({ className, ...props }, forwardedRef) {
		return (
			<div
				{...props}
				ref={forwardedRef}
				data-slot="sidebar-content"
				className={cn(
					"flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden overscroll-contain px-2 py-2",
					className,
				)}
			/>
		);
	},
);

export const AnimatedSidebarFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
	function AnimatedSidebarFooter({ className, ...props }, forwardedRef) {
		return (
			<div
				{...props}
				ref={forwardedRef}
				data-slot="sidebar-footer"
				className={cn(
					"flex shrink-0 flex-col gap-2 border-border border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]",
					className,
				)}
			/>
		);
	},
);

export const AnimatedSidebarGroup = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
	function AnimatedSidebarGroup({ className, ...props }, forwardedRef) {
		return (
			<div
				{...props}
				ref={forwardedRef}
				data-slot="sidebar-group"
				className={cn("flex w-full min-w-0 flex-col px-1 py-1.5", className)}
			/>
		);
	},
);

export const AnimatedSidebarGroupLabel = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
	function AnimatedSidebarGroupLabel({ children, className, ...props }, forwardedRef) {
		const { collapsed } = useAnimatedSidebarPanel();

		return (
			<div
				{...props}
				ref={forwardedRef}
				aria-hidden={collapsed}
				data-slot="sidebar-group-label"
				className={cn(
					"mb-1 h-7 overflow-hidden px-2 text-micro font-medium uppercase tracking-[0.14em] text-muted-foreground transition-opacity",
					collapsed ? "opacity-0" : "opacity-100",
					className,
				)}
			>
				{children}
			</div>
		);
	},
);

export const AnimatedSidebarGroupContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
	function AnimatedSidebarGroupContent({ className, ...props }, forwardedRef) {
		return (
			<div
				{...props}
				ref={forwardedRef}
				data-slot="sidebar-group-content"
				className={cn("w-full min-w-0", className)}
			/>
		);
	},
);
