"use client";

// Adapted from Lina by SameerJS6 (https://lina.sameer.sh) — use-has-primary-touch.
// Detects touch-primary devices (coarse pointer + touch points), updating live
// on pointer-mode and media-query changes. Returns false on the server and the
// first client render, so the non-touch branch is the hydration-stable default.

import { useEffect, useState } from "react";

/** Reports whether the device has touch input and currently prefers a coarse
 * pointer. Returns false during SSR and the first client render, then updates
 * on pointer activity or coarse-pointer media query changes. */
export function useTouchPrimary() {
	const [isTouchPrimary, setIsTouchPrimary] = useState(false);

	useEffect(() => {
		if (typeof window === "undefined") return;

		const controller = new AbortController();
		const { signal } = controller;

		const handleTouch = () => {
			const hasTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
			const prefersTouch = window.matchMedia("(pointer: coarse)").matches;
			setIsTouchPrimary(hasTouch && prefersTouch);
		};

		const mq = window.matchMedia("(pointer: coarse)");
		mq.addEventListener("change", handleTouch, { signal });
		window.addEventListener("pointerdown", handleTouch, { signal });

		handleTouch();

		return () => controller.abort();
	}, []);

	return isTouchPrimary;
}
