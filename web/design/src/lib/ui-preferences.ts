import { readStoredValue } from "./safe-storage";

export const UI_PREFERENCES_KEY = "fleet-prime:v1:ui-preferences";

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

export function readUiPreferences(): UiPreferences {
	try {
		const parsed = JSON.parse(readStoredValue(UI_PREFERENCES_KEY) ?? "null") as Partial<UiPreferences> | null;
		return { ...DEFAULT_UI_PREFERENCES, ...parsed };
	} catch {
		return DEFAULT_UI_PREFERENCES;
	}
}
