import { createContext } from "react";

export type SettingsDraftStatus = { dirty: boolean; busy: boolean };
export type SettingsDraftRegistry = {
	dirtySections: Array<string>;
	busy: boolean;
	resetVersions: Record<string, number>;
	cancelSection: (section: string) => void;
	update: (key: string, section: string, status: SettingsDraftStatus | null) => void;
};

export const SettingsDraftContext = createContext<SettingsDraftRegistry | null>(null);
