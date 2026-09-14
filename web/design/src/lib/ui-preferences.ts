import { useSyncExternalStore } from "react";
import { readStoredValue, writeStoredValue } from "./safe-storage";

export const UI_PREFERENCES_KEY = "fleet-prime:v1:ui-preferences";
export const UI_PREFERENCES_EVENT = "fleet-prime:ui-preferences";

export type UiPreferences = {
	density: "comfortable" | "compact";
	motion: "system" | "reduced";
	transcript: "follow" | "manual";
	confirmSessionDelete: boolean;
};

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
	density: "comfortable",
	motion: "system",
	transcript: "follow",
	confirmSessionDelete: true,
};

const listeners = new Set<() => void>();
let snapshot: UiPreferences = DEFAULT_UI_PREFERENCES;
let snapshotRaw: string | null = null;

export function readUiPreferences(): UiPreferences {
	try {
		const raw = readStoredValue(UI_PREFERENCES_KEY) ?? "null";
		if (raw === snapshotRaw) return snapshot;
		const parsed = JSON.parse(raw) as Partial<UiPreferences> | null;
		const next = { ...DEFAULT_UI_PREFERENCES, ...parsed };
		snapshotRaw = raw;
		if (
			next.density === snapshot.density &&
			next.motion === snapshot.motion &&
			next.transcript === snapshot.transcript &&
			next.confirmSessionDelete === snapshot.confirmSessionDelete
		) {
			return snapshot;
		}
		snapshot = next;
		return snapshot;
	} catch {
		snapshotRaw = null;
		snapshot = DEFAULT_UI_PREFERENCES;
		return snapshot;
	}
}

export function applyUiPreferencesToDocument(preferences: UiPreferences) {
	if (typeof document === "undefined") return;
	document.documentElement.dataset.density = preferences.density;
	document.documentElement.classList.toggle("reduce-motion", preferences.motion === "reduced");
}

export function writeUiPreferences(preferences: UiPreferences) {
	writeStoredValue(UI_PREFERENCES_KEY, JSON.stringify(preferences));
	snapshot = preferences;
	snapshotRaw = JSON.stringify(preferences);
	applyUiPreferencesToDocument(preferences);
	for (const listener of listeners) listener();
	if (typeof window !== "undefined") {
		window.dispatchEvent(new Event(UI_PREFERENCES_EVENT));
	}
}

function subscribeUiPreferences(onStoreChange: () => void) {
	listeners.add(onStoreChange);
	if (typeof window === "undefined") {
		return () => {
			listeners.delete(onStoreChange);
		};
	}
	window.addEventListener(UI_PREFERENCES_EVENT, onStoreChange);
	window.addEventListener("storage", onStoreChange);
	return () => {
		listeners.delete(onStoreChange);
		window.removeEventListener(UI_PREFERENCES_EVENT, onStoreChange);
		window.removeEventListener("storage", onStoreChange);
	};
}

export function useUiPreferences(): UiPreferences {
	return useSyncExternalStore(subscribeUiPreferences, readUiPreferences, () => DEFAULT_UI_PREFERENCES);
}
