import { Cpu, HardDrive, KeyRound, Paintbrush, Settings, Sparkles } from "lucide-react";

type LucideIcon = typeof Cpu;

export type SettingsSectionId = "appearance" | "sandbox" | "providers" | "llm-models" | "skills" | "pi-harness";

export type SettingsSection = {
	id: SettingsSectionId;
	title: string;
	icon: LucideIcon;
};

export const SETTINGS_SECTIONS: Array<SettingsSection> = [
	{ id: "appearance", title: "Appearance", icon: Paintbrush },
	{ id: "sandbox", title: "Sandbox", icon: HardDrive },
	{ id: "providers", title: "Providers", icon: KeyRound },
	{ id: "llm-models", title: "LLM Models", icon: Cpu },
	{ id: "skills", title: "Skills", icon: Sparkles },
	{ id: "pi-harness", title: "Pi Harness", icon: Settings },
];

export function isSettingsSectionId(value: string): value is SettingsSectionId {
	return SETTINGS_SECTIONS.some((section) => section.id === value);
}
