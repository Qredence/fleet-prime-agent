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
	if (typeof window === "undefined") return DEFAULT_UI_PREFERENCES;
	try {
		const parsed = JSON.parse(
			window.localStorage.getItem(UI_PREFERENCES_KEY) ?? "null",
		) as Partial<UiPreferences> | null;
		return { ...DEFAULT_UI_PREFERENCES, ...parsed };
	} catch {
		return DEFAULT_UI_PREFERENCES;
	}
}
