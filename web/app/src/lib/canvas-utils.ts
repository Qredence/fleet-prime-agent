import type { RightPanelState } from "@prime-agent/web-protocol/fleet-contract";
import {
	getResourceCanvasSessionSidebarWidthPx,
	RESOURCE_CANVAS_DEFAULT_VIEWPORT_RATIO,
	RESOURCE_CANVAS_MAIN_CONTENT_MIN_WIDTH_PX,
} from "@/lib/layout-constants";
import { readStoredValue, writeStoredValue } from "@/lib/safe-storage";
import { readStoredWidth, storeStoredWidth } from "@/lib/stored-width";

const RESOURCE_CANVAS_WIDTH_STORAGE_KEY = "fleet-prime:v1:right-panel-width";
const THEME_PREFERENCE_STORAGE_KEY = "fleet-prime:v1:theme-preference";
const RESOURCE_CANVAS_MIN_WIDTH = 320;

export type ThemePreference = "light" | "dark" | "system";

export type RightPanel = RightPanelState;

/** Returns the default right-panel width clamped to the available chat space, or the minimum during SSR. */
export function getResourceCanvasInitialWidth() {
	if (typeof window === "undefined") return RESOURCE_CANVAS_MIN_WIDTH;
	return clampResourceCanvasWidth(Math.floor(window.innerWidth * RESOURCE_CANVAS_DEFAULT_VIEWPORT_RATIO));
}

/** Returns the largest right-panel width that preserves the sidebar and main chat column, or the minimum during SSR. */
export function getResourceCanvasMaxWidth() {
	if (typeof window === "undefined") return RESOURCE_CANVAS_MIN_WIDTH;
	const computedRootFontSizePx = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize);
	const rootFontSizePx =
		Number.isFinite(computedRootFontSizePx) && computedRootFontSizePx > 0 ? computedRootFontSizePx : 16;
	const sessionSidebarWidthPx = getResourceCanvasSessionSidebarWidthPx(rootFontSizePx);
	// Panel sits beside the session sidebar inside the chat shell, so reserve
	// both the sidebar and a usable chat column — not just 360px of viewport.
	return Math.max(
		RESOURCE_CANVAS_MIN_WIDTH,
		window.innerWidth - sessionSidebarWidthPx - RESOURCE_CANVAS_MAIN_CONTENT_MIN_WIDTH_PX,
	);
}

export function clampResourceCanvasWidth(width: number) {
	return Math.min(getResourceCanvasMaxWidth(), Math.max(RESOURCE_CANVAS_MIN_WIDTH, Math.round(width)));
}

export function readStoredResourceCanvasWidth() {
	return readStoredWidth(RESOURCE_CANVAS_WIDTH_STORAGE_KEY, getResourceCanvasInitialWidth(), clampResourceCanvasWidth);
}

export function storeResourceCanvasWidth(width: number) {
	storeStoredWidth(RESOURCE_CANVAS_WIDTH_STORAGE_KEY, clampResourceCanvasWidth(width));
}

export function readStoredThemePreference(): ThemePreference {
	if (typeof window === "undefined") return "system";

	const value = readStoredValue(THEME_PREFERENCE_STORAGE_KEY);
	return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function storeThemePreference(preference: ThemePreference) {
	writeStoredValue(THEME_PREFERENCE_STORAGE_KEY, preference);
}

export function applyThemePreference(preference: ThemePreference) {
	if (typeof window === "undefined") return;

	const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
	const dark = preference === "dark" || (preference === "system" && systemDark);
	document.documentElement.classList.toggle("dark", dark);
	document.documentElement.dataset.theme = dark ? "dark" : "light";
}
