export function readStoredWidth(storageKey: string, defaultWidth: number, clamp: (width: number) => number) {
	if (typeof window === "undefined") return defaultWidth;

	const value = Number(window.localStorage.getItem(storageKey));
	return Number.isFinite(value) ? clamp(value) : defaultWidth;
}

export function storeStoredWidth(storageKey: string, width: number) {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(storageKey, String(Math.round(width)));
}
