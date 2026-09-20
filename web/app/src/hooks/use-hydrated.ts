"use client";

import { useSyncExternalStore } from "react";

function subscribe() {
	return () => {};
}

function getSnapshot() {
	return true;
}

function getServerSnapshot() {
	return false;
}

/** False during SSR, true after client hydration. Gates browser-only portals. */
export function useHydrated(): boolean {
	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
