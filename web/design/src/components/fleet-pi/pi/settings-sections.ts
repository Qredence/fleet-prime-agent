import { Cpu, HardDrive, Keyboard, KeyRound, MessageSquare, Paintbrush, Settings, Sparkles, Users } from "lucide-react";

type LucideIcon = typeof Cpu;

export type SettingsSectionId =
	| "appearance"
	| "chat"
	| "sandbox"
	| "providers"
	| "llm-models"
	| "skills"
	| "pi-harness"
	| "keybindings"
	| "sessions";

export type SettingsSection = {
	id: SettingsSectionId;
	title: string;
	icon: LucideIcon;
};

export const SETTINGS_SECTIONS: Array<SettingsSection> = [
	{ id: "appearance", title: "Appearance", icon: Paintbrush },
	{ id: "chat", title: "Chat", icon: MessageSquare },
	{ id: "sandbox", title: "Sandbox", icon: HardDrive },
	{ id: "providers", title: "Providers", icon: KeyRound },
	{ id: "llm-models", title: "LLM Models", icon: Cpu },
	{ id: "skills", title: "Skills", icon: Sparkles },
	{ id: "pi-harness", title: "Pi Harness", icon: Settings },
	{ id: "keybindings", title: "Keybindings", icon: Keyboard },
	{ id: "sessions", title: "Sessions", icon: Users },
];

export function isSettingsSectionId(value: string): value is SettingsSectionId {
	return SETTINGS_SECTIONS.some((section) => section.id === value);
}
