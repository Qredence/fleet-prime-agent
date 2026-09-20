// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { clampResourceCanvasWidth, getResourceCanvasMaxWidth } from "@/components/layout/canvas-utils";
import { RESOURCE_CANVAS_MAIN_CONTENT_MIN_WIDTH_PX, SESSION_SIDEBAR_WIDTH_REM } from "@/lib/layout-constants";

describe("resource canvas width", () => {
	const originalInnerWidth = window.innerWidth;
	const originalRootFontSize = document.documentElement.style.fontSize;

	afterEach(() => {
		Object.defineProperty(window, "innerWidth", {
			configurable: true,
			value: originalInnerWidth,
		});
		document.documentElement.style.fontSize = originalRootFontSize;
	});

	it("reserves the session sidebar plus a chat floor when computing max width", () => {
		Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });

		const sessionSidebarWidthPx = SESSION_SIDEBAR_WIDTH_REM * 16;
		expect(getResourceCanvasMaxWidth()).toBe(
			1280 - sessionSidebarWidthPx - RESOURCE_CANVAS_MAIN_CONTENT_MIN_WIDTH_PX,
		);
		expect(clampResourceCanvasWidth(2000)).toBe(640);
		// Expanded sidebar (280) + chat floor (360) still leave 640px for chat at max widen.
		expect(1280 - sessionSidebarWidthPx - 640).toBe(360);
	});

	it("uses the computed root font size for the session sidebar reservation", () => {
		Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
		document.documentElement.style.fontSize = "20px";

		const sessionSidebarWidthPx = SESSION_SIDEBAR_WIDTH_REM * 20;
		const maxPanelWidth = getResourceCanvasMaxWidth();
		expect(maxPanelWidth).toBe(570);
		expect(1280 - sessionSidebarWidthPx - maxPanelWidth).toBe(RESOURCE_CANVAS_MAIN_CONTENT_MIN_WIDTH_PX);
	});

	it("floors at the panel minimum on narrow viewports", () => {
		Object.defineProperty(window, "innerWidth", { configurable: true, value: 900 });

		expect(getResourceCanvasMaxWidth()).toBe(320);
		expect(clampResourceCanvasWidth(480)).toBe(320);
	});
});
