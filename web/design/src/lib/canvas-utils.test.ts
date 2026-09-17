// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { clampResourceCanvasWidth, getResourceCanvasMaxWidth } from "./canvas-utils";
import {
	RESOURCE_CANVAS_MAIN_CONTENT_MIN_WIDTH_PX,
	RESOURCE_CANVAS_SESSION_SIDEBAR_WIDTH_PX,
} from "./layout-constants";

describe("resource canvas width", () => {
	const originalInnerWidth = window.innerWidth;

	afterEach(() => {
		Object.defineProperty(window, "innerWidth", {
			configurable: true,
			value: originalInnerWidth,
		});
	});

	it("reserves the session sidebar plus a chat floor when computing max width", () => {
		Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });

		expect(getResourceCanvasMaxWidth()).toBe(
			1280 - RESOURCE_CANVAS_SESSION_SIDEBAR_WIDTH_PX - RESOURCE_CANVAS_MAIN_CONTENT_MIN_WIDTH_PX,
		);
		expect(clampResourceCanvasWidth(2000)).toBe(640);
		// Expanded sidebar (280) + chat floor (360) still leave 640px for chat at max widen.
		expect(1280 - RESOURCE_CANVAS_SESSION_SIDEBAR_WIDTH_PX - 640).toBe(360);
	});

	it("floors at the panel minimum on narrow viewports", () => {
		Object.defineProperty(window, "innerWidth", { configurable: true, value: 900 });

		expect(getResourceCanvasMaxWidth()).toBe(320);
		expect(clampResourceCanvasWidth(480)).toBe(320);
	});
});
