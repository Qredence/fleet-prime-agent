"use client";

import { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from "react";

type ShapeVariant = "rounded" | "sharp";

interface ShapeClasses {
	/** The variant these classes belong to — handy for conditionals. */
	variant: ShapeVariant;
	item: string;
	bg: string;
	focusRing: string;
	container: string;
	button: string;
	input: string;
	// Numeric counterpart of `bg`, in px. Needed where individual corners are
	// animated (e.g. the selected-background merge/split animation), which
	// requires per-corner numeric border-radii rather than a class.
	bgRadius: number;
	/** Radius of an item background merged with its neighbors. */
	mergedRadius: number;
}

/**
 * Radius for a surface inset inside another rounded surface.
 *
 * `inset` is the interior spacing (usually parent padding); pass the parent's
 * border separately as `borderWidth`. Together they form the visible
 * edge-to-edge distance. Clamping at zero prevents an invalid negative radius.
 */
function nestedRadius(outerRadius: number, inset: number, borderWidth = 0) {
	return Math.max(0, outerRadius - inset - borderWidth);
}

const shapeMap: Record<ShapeVariant, ShapeClasses> = {
	// Concentric with the theme's radius ladder (see LAYOUT.md): items and
	// controls take the 8px inner step (rounded-sm), cards/dialogs/popovers
	// the 16px shell step (rounded-md). The composer keeps the 24px outer
	// step via its own --radius-chat-input token.
	rounded: {
		variant: "rounded",
		item: "rounded-sm",
		bg: "rounded-sm",
		// +2px over `item` because the focus ring sits 2px outside the element
		// (top/left -2, width/height +4); this keeps the corners concentric.
		focusRing: "rounded-[10px]",
		container: "rounded-md",
		button: "rounded-sm",
		input: "rounded-sm",
		bgRadius: 8,
		mergedRadius: 8,
	},
	// Sharp keeps a 1px radius rather than 0 so corners still anti-alias softly.
	// Containers stay at 1px too: concentric radii stop mattering at this size.
	sharp: {
		variant: "sharp",
		item: "rounded-[1px]",
		bg: "rounded-[1px]",
		focusRing: "rounded-[3px]",
		container: "rounded-[1px]",
		button: "rounded-[1px]",
		input: "rounded-[1px]",
		bgRadius: 1,
		mergedRadius: 1,
	},
};

// Popup shells (menus, select and combobox lists) inset their items by 4px,
// so the shell takes the concentric 8px + 4px = 12px radius instead of the
// 16px card step. Sharp carries over, so a sharp UI gets sharp menus.
const popupShapeMap: Record<ShapeVariant, ShapeClasses> = {
	rounded: { ...shapeMap.rounded, container: "rounded-[12px]" },
	sharp: shapeMap.sharp,
};

interface ShapeContextValue {
	shape: ShapeVariant;
	setShape: (shape: ShapeVariant) => void;
	classes: ShapeClasses;
}

const ShapeContext = createContext<ShapeContextValue | null>(null);

// Rounded is the default on every path: the shipped :focus-visible fallback
// ring assumes its 8px radius, and a consumer with no provider gets the
// default corners.
function useShape(): ShapeClasses {
	const ctx = useContext(ShapeContext);
	if (!ctx) return shapeMap.rounded;
	return ctx.classes;
}

function usePopupShape(): ShapeClasses {
	return popupShapeMap[useShape().variant];
}

function ShapeProvider({ children, defaultShape = "rounded" }: { children: ReactNode; defaultShape?: ShapeVariant }) {
	const [shape, setShapeState] = useState<ShapeVariant>(defaultShape);
	const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Run a state change under the `.transitioning` guard (added + reflow-flushed
	// first so the 180ms border-radius cross-fade applies). Clearing the previous
	// timeout first keeps a double-press from removing the class mid-fade.
	const transitionShape = useCallback((callback: () => void) => {
		const root = document.documentElement;
		root.classList.add("transitioning");
		void root.offsetHeight;
		callback();
		if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current);
		transitionTimeoutRef.current = setTimeout(() => root.classList.remove("transitioning"), 200);
	}, []);

	const setShape = useCallback(
		(next: ShapeVariant) => {
			transitionShape(() => setShapeState(next));
		},
		[transitionShape],
	);

	// Publish the current element radius as a CSS custom property so plain-CSS
	// consumers that can't read React context stay in sync with the shape
	// system — e.g. the @layer base :focus-visible fallback ring in
	// globals.css. Set on <html> so portalled content sees it too.
	useEffect(() => {
		document.documentElement.style.setProperty("--shape-input-radius", `${shapeMap[shape].bgRadius}px`);
	}, [shape]);

	const value = useMemo(() => ({ shape, setShape, classes: shapeMap[shape] }), [shape, setShape]);

	return <ShapeContext.Provider value={value}>{children}</ShapeContext.Provider>;
}

export { ShapeProvider, useShape, usePopupShape, nestedRadius };
export type { ShapeVariant };
