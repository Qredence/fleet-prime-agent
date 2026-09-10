import { readStoredValue, writeStoredValue } from "./safe-storage";

export function readStoredWidth(storageKey: string, defaultWidth: number, clamp: (width: number) => number) {
	if (typeof window === "undefined") return defaultWidth;

	const stored = readStoredValue(storageKey);
	if (stored === null) return defaultWidth;
	const value = Number(stored);
	return Number.isFinite(value) ? clamp(value) : defaultWidth;
}

export function storeStoredWidth(storageKey: string, width: number) {
	writeStoredValue(storageKey, String(Math.round(width)));
}
