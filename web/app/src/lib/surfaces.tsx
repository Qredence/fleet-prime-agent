"use client";

import {
	type ComponentProps,
	createContext,
	type ReactNode,
	useContext,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { cn } from "@/lib/utils";

const SurfaceContext = createContext<number>(1);

export function useSurface(): number {
	return useContext(SurfaceContext);
}

export function SurfaceProvider({ value, children }: { value: number; children: ReactNode }) {
	return <SurfaceContext.Provider value={Math.max(1, Math.min(8, value))}>{children}</SurfaceContext.Provider>;
}

const SURFACE_BG: Record<number, string> = {
	1: "bg-surface-1",
	2: "bg-surface-2",
	3: "bg-surface-3",
	4: "bg-surface-4",
	5: "bg-surface-5",
	6: "bg-surface-6",
	7: "bg-surface-7",
	8: "bg-surface-8",
};

const SURFACE_SHADOW: Record<number, string> = {
	1: "shadow-surface-1",
	2: "shadow-surface-2",
	3: "shadow-surface-3",
	4: "shadow-surface-4",
	5: "shadow-surface-5",
	6: "shadow-surface-6",
	7: "shadow-surface-7",
	8: "shadow-surface-8",
};

export function surfaceClasses(bgLevel: number, shadowLevel: number = bgLevel): string {
	const bg = Math.round(Math.max(1, Math.min(8, bgLevel)));
	const shadow = Math.round(Math.max(1, Math.min(8, shadowLevel)));
	return `${SURFACE_BG[bg]} ${SURFACE_SHADOW[shadow]}`;
}

export const paper =
	"bg-background shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-16px_rgba(0,0,0,0.12)] dark:bg-popover dark:shadow-none";

/** Opaque elevated menu for chrome popovers (mode, search, attach) on dark surfaces. */
export const elevatedMenu = "border border-border bg-popover text-popover-foreground shadow-lg";

export const floating =
	"bg-background shadow-[0_2px_8px_rgba(0,0,0,0.05),0_20px_48px_-16px_rgba(0,0,0,0.18)] dark:bg-popover dark:shadow-[0_20px_48px_-16px_rgba(0,0,0,0.55)]";

export const field = "bg-foreground/[0.04] dark:bg-foreground/[0.06]";

const labelSwap =
	"col-start-1 row-start-1 flex w-max items-center gap-1.5 leading-none transition-[opacity,filter] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none";
const labelSwapIn = "opacity-100 blur-none";
const labelSwapOut = "pointer-events-none select-none opacity-0 blur-[2px]";

export const collapsePanel =
	"h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] data-[ending-style]:h-0 data-[starting-style]:h-0 motion-reduce:transition-none";

export const mono = "font-mono text-caption tracking-tight";

export function ShimmerLabel({ active = true, className, ...props }: ComponentProps<"span"> & { active?: boolean }) {
	return <span className={cn(active && "shimmer motion-reduce:animate-none", className)} {...props} />;
}

export function SwapLabel({
	active,
	children,
	className,
}: {
	active: 0 | 1;
	children: [React.ReactNode, React.ReactNode];
	className?: string;
}) {
	const firstLayerRef = useRef<HTMLSpanElement>(null);
	const secondLayerRef = useRef<HTMLSpanElement>(null);
	const [width, setWidth] = useState<number | null>(null);

	useLayoutEffect(() => {
		const target = (active === 0 ? firstLayerRef : secondLayerRef).current;
		if (!target) return undefined;
		const measure = () => setWidth(Math.ceil(target.getBoundingClientRect().width));
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(target);
		return () => observer.disconnect();
	}, [active]);

	return (
		<span
			style={width === null ? undefined : { width }}
			className={cn(
				"grid overflow-x-clip transition-[width] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
				className,
			)}
		>
			<span
				ref={firstLayerRef}
				aria-hidden={active !== 0}
				className={cn(labelSwap, active === 0 ? labelSwapIn : labelSwapOut)}
			>
				{children[0]}
			</span>
			<span
				ref={secondLayerRef}
				aria-hidden={active !== 1}
				className={cn(labelSwap, active === 1 ? labelSwapIn : labelSwapOut)}
			>
				{children[1]}
			</span>
		</span>
	);
}
