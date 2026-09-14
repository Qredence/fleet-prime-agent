"use client";

import { useSyncExternalStore } from "react";
import { CHROME_MOBILE_MAX_WIDTH_QUERY } from "../layout-constants";

function subscribeToChromeMobile(onStoreChange: () => void) {
	const query = window.matchMedia(CHROME_MOBILE_MAX_WIDTH_QUERY);
	query.addEventListener("change", onStoreChange);
	return () => query.removeEventListener("change", onStoreChange);
}

function getChromeMobileSnapshot() {
	return window.matchMedia(CHROME_MOBILE_MAX_WIDTH_QUERY).matches;
}

function getServerChromeMobileSnapshot() {
	return false;
}

/** True below the shared chrome mobile breakpoint (768px / Tailwind `md`). */
export function useIsMobile() {
	return useSyncExternalStore(subscribeToChromeMobile, getChromeMobileSnapshot, getServerChromeMobileSnapshot);
}
