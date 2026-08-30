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
	order: number;
	title: string;
	ariaLabel: string;
	icon: LucideIcon;
};

export const SETTINGS_SECTION_REGISTRY = {
	appearance: { id: "appearance", order: 10, title: "Appearance", ariaLabel: "Appearance settings", icon: Paintbrush },
	chat: { id: "chat", order: 20, title: "Chat", ariaLabel: "Chat settings", icon: MessageSquare },
	sandbox: { id: "sandbox", order: 30, title: "Sandbox", ariaLabel: "Sandbox settings", icon: HardDrive },
	providers: { id: "providers", order: 40, title: "Providers", ariaLabel: "Provider settings", icon: KeyRound },
	"llm-models": { id: "llm-models", order: 50, title: "LLM Models", ariaLabel: "LLM model settings", icon: Cpu },
	skills: { id: "skills", order: 60, title: "Skills", ariaLabel: "Skill settings", icon: Sparkles },
	"pi-harness": { id: "pi-harness", order: 70, title: "Pi Harness", ariaLabel: "Pi harness settings", icon: Settings },
	keybindings: {
		id: "keybindings",
		order: 80,
		title: "Keybindings",
		ariaLabel: "Keybinding settings",
		icon: Keyboard,
	},
	sessions: { id: "sessions", order: 90, title: "Sessions", ariaLabel: "Session settings", icon: Users },
} satisfies Record<SettingsSectionId, SettingsSection>;

export const SETTINGS_SECTIONS = Object.values(SETTINGS_SECTION_REGISTRY).sort(
	(left, right) => left.order - right.order,
);

export function isSettingsSectionId(value: string): value is SettingsSectionId {
	return SETTINGS_SECTIONS.some((section) => section.id === value);
}
