import {
	Cpu,
	HardDrive,
	Keyboard,
	KeyRound,
	MessageSquare,
	Paintbrush,
	Plug,
	Settings,
	Sparkles,
	Users,
} from "lucide-react";

type LucideIcon = typeof Cpu;

export type SettingsSectionId =
	| "appearance"
	| "chat"
	| "mcp"
	| "sandbox"
	| "providers"
	| "llm-models"
	| "skills"
	| "pi-harness"
	| "keybindings"
	| "sessions";

export type SettingsSectionGroup = "workspace" | "models" | "advanced";

export type SettingsSection = {
	id: SettingsSectionId;
	order: number;
	title: string;
	ariaLabel: string;
	icon: LucideIcon;
	group: SettingsSectionGroup;
};

export const SETTINGS_SECTION_REGISTRY = {
	appearance: {
		id: "appearance",
		order: 10,
		title: "Appearance",
		ariaLabel: "Appearance settings",
		icon: Paintbrush,
		group: "workspace",
	},
	chat: { id: "chat", order: 20, title: "Chat", ariaLabel: "Chat settings", icon: MessageSquare, group: "workspace" },
	mcp: {
		id: "mcp",
		order: 25,
		title: "MCP",
		ariaLabel: "MCP connection settings",
		icon: Plug,
		group: "workspace",
	},
	sandbox: {
		id: "sandbox",
		order: 30,
		title: "Sandbox",
		ariaLabel: "Sandbox settings",
		icon: HardDrive,
		group: "advanced",
	},
	providers: {
		id: "providers",
		order: 40,
		title: "Providers",
		ariaLabel: "Provider settings",
		icon: KeyRound,
		group: "models",
	},
	"llm-models": {
		id: "llm-models",
		order: 50,
		title: "LLM Models",
		ariaLabel: "LLM model settings",
		icon: Cpu,
		group: "models",
	},
	skills: { id: "skills", order: 60, title: "Skills", ariaLabel: "Skill settings", icon: Sparkles, group: "advanced" },
	"pi-harness": {
		id: "pi-harness",
		order: 70,
		title: "Pi Harness",
		ariaLabel: "Pi harness settings",
		icon: Settings,
		group: "advanced",
	},
	keybindings: {
		id: "keybindings",
		order: 80,
		title: "Keybindings",
		ariaLabel: "Keybinding settings",
		icon: Keyboard,
		group: "advanced",
	},
	sessions: {
		id: "sessions",
		order: 90,
		title: "Sessions",
		ariaLabel: "Session settings",
		icon: Users,
		group: "workspace",
	},
} satisfies Record<SettingsSectionId, SettingsSection>;

export const SETTINGS_SECTION_GROUPS: ReadonlyArray<{ id: SettingsSectionGroup; label: string }> = [
	{ id: "workspace", label: "Workspace" },
	{ id: "models", label: "Models" },
	{ id: "advanced", label: "Advanced" },
];

export const SETTINGS_SECTIONS = Object.values(SETTINGS_SECTION_REGISTRY).sort(
	(left, right) => left.order - right.order,
);

export function isSettingsSectionId(value: string): value is SettingsSectionId {
	return SETTINGS_SECTIONS.some((section) => section.id === value);
}
