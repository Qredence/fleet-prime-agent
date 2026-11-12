"use client";

import { createContext, type ReactNode, useContext } from "react";

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

export const field = "bg-foreground/[0.04] dark:bg-foreground/[0.06]";

export const mono = "font-mono text-caption tracking-tight";
