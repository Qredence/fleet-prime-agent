import {
	Cpu,
	HardDrive,
	Keyboard,
	KeyRound,
	LayoutDashboard,
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
	| "sessions"
	| "dashboards"
	| "context"
	| "retry-delivery"
	| "prompts"
	| "extensions-packages"
	| "services";

export type SettingsSectionGroup = "workspace" | "models" | "advanced" | "integrations";

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
		group: "integrations",
	},
	sandbox: {
		id: "sandbox",
		order: 30,
		title: "Sandbox",
		ariaLabel: "Sandbox settings",
		icon: HardDrive,
		group: "integrations",
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
		title: "Runtime & resources",
		ariaLabel: "Pi harness settings",
		icon: Settings,
		group: "advanced",
	},
	keybindings: {
		id: "keybindings",
		order: 80,
		title: "Keyboard shortcuts",
		ariaLabel: "Keybinding settings",
		icon: Keyboard,
		group: "workspace",
	},
	sessions: {
		id: "sessions",
		order: 90,
		title: "Sessions",
		ariaLabel: "Session settings",
		icon: Users,
		group: "workspace",
	},
	dashboards: {
		id: "dashboards",
		order: 45,
		title: "Dashboards",
		ariaLabel: "Dashboard settings",
		icon: LayoutDashboard,
		group: "workspace",
	},
	context: {
		id: "context",
		order: 100,
		title: "Context & compaction",
		ariaLabel: "Context & compaction settings",
		icon: Settings,
		group: "advanced",
	},
	"retry-delivery": {
		id: "retry-delivery",
		order: 110,
		title: "Retry & delivery",
		ariaLabel: "Retry & delivery settings",
		icon: Settings,
		group: "advanced",
	},
	prompts: {
		id: "prompts",
		order: 120,
		title: "Prompt templates",
		ariaLabel: "Prompt templates settings",
		icon: Settings,
		group: "advanced",
	},
	"extensions-packages": {
		id: "extensions-packages",
		order: 130,
		title: "Extensions & packages",
		ariaLabel: "Extensions & packages settings",
		icon: Settings,
		group: "advanced",
	},
	services: {
		id: "services",
		order: 140,
		title: "Optional services",
		ariaLabel: "Optional services settings",
		icon: Settings,
		group: "workspace",
	},
} satisfies Record<SettingsSectionId, SettingsSection>;

export const SETTINGS_SECTION_GROUPS: ReadonlyArray<{ id: SettingsSectionGroup; label: string }> = [
	{ id: "workspace", label: "Fleet preferences" },
	{ id: "models", label: "Prime Agent models" },
	{ id: "advanced", label: "Prime Agent runtime" },
	{ id: "integrations", label: "Integrations" },
];

export const SETTINGS_SECTIONS = Object.values(SETTINGS_SECTION_REGISTRY)
	.filter((section) => section.id !== "pi-harness" && section.id !== "dashboards")
	.sort((left, right) => left.order - right.order);

export function isSettingsSectionId(value: string): value is SettingsSectionId {
	return Object.hasOwn(SETTINGS_SECTION_REGISTRY, value);
}

export function canonicalSettingsSection(id: SettingsSectionId): SettingsSectionId {
	return id === "pi-harness" ? "context" : id === "dashboards" ? "services" : id;
}
export const SETTINGS_SEARCH_ENTRIES: ReadonlyArray<{ section: SettingsSectionId; label: string; target: string }> = [
	{ section: "providers", label: "Provider credentials · API keys · authentication", target: "Search credentials" },
	{
		section: "llm-models",
		label: "Default model · enabled models · reasoning effort",
		target: "Search listed models",
	},
	{ section: "sandbox", label: "Daytona API key", target: "Daytona API key" },
	{ section: "sandbox", label: "Region / target", target: "Region / target" },
	{ section: "keybindings", label: "Keyboard shortcuts · command palette · panels", target: "" },
	{ section: "appearance", label: "Theme", target: "Theme" },
	{ section: "appearance", label: "Density", target: "Density" },
	{ section: "appearance", label: "Motion", target: "Motion" },
	{ section: "chat", label: "Streaming transcript", target: "Streaming transcript" },
	{ section: "sessions", label: "Confirm session deletion", target: "Confirm session deletion" },
	{ section: "services", label: "Describe a command", target: "Describe a command" },
	{ section: "services", label: "TypeSafe API key", target: "TypeSafe API key" },
	{ section: "services", label: "Dashboard builder model", target: "Dashboard model" },
	{ section: "services", label: "Thesys API key", target: "Thesys API key" },
	{ section: "context", label: "Compaction", target: "Compaction" },
	{ section: "context", label: "Reserved context tokens", target: "Reserved context tokens" },
	{ section: "context", label: "Recent context tokens", target: "Recent context tokens" },
	{ section: "retry-delivery", label: "Auto-retry", target: "Auto-retry" },
	{ section: "retry-delivery", label: "Maximum retries", target: "Maximum retries" },
	{ section: "retry-delivery", label: "Retry delay (milliseconds)", target: "Retry delay (milliseconds)" },
	{ section: "retry-delivery", label: "Steering", target: "Steering" },
	{ section: "retry-delivery", label: "Follow-up", target: "Follow-up" },
	{ section: "llm-models", label: "Provider inference transport", target: "Provider inference transport" },
	{ section: "skills", label: "Skill slash commands", target: "Skill slash commands" },
	{ section: "skills", label: "Additional skill paths", target: "Add skill" },
	{ section: "prompts", label: "Prompt template paths", target: "Add prompt" },
	{ section: "extensions-packages", label: "Packages", target: "Add package" },
	{ section: "extensions-packages", label: "Extensions", target: "Add extension" },
	{
		section: "mcp",
		label: "MCP servers · HTTP · stdio · OAuth · environment variables",
		target: "Search MCP servers",
	},
];
