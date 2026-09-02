import { Bot, ListTodo, Settings2 } from "lucide-react";

export const FLEET_PI_CHAT_MODES = [
	{ id: "agent", label: "Agent", icon: Bot, description: "Default coding agent" },
	{ id: "plan", label: "Plan", icon: ListTodo, description: "Plan before executing" },
	{ id: "harness", label: "Harness", icon: Settings2, description: "Harness-aware turn" },
] as const;
