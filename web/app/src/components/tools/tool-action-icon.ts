import type { LucideIcon } from "lucide-react";
import {
	FilePenLine,
	FileSearch,
	Globe2,
	Image,
	ListTodo,
	MessageCircleQuestion,
	Search,
	ShieldCheck,
	Terminal,
	UsersRound,
	Wrench,
} from "lucide-react";

/** Selects a compact, contextual icon for a tool or activity name. */
export function toolActionIconForName(name: string): LucideIcon {
	const lower = name.toLowerCase();
	if (lower.includes("plan") || lower.includes("todo")) return ListTodo;
	if (lower.includes("approval") || lower.includes("permission")) return ShieldCheck;
	if (lower.includes("question") || lower.includes("ask")) return MessageCircleQuestion;
	if (lower.includes("citation") || lower.includes("source")) return Globe2;
	if (lower.includes("agent") || lower.includes("task") || lower.includes("rlm")) return UsersRound;
	if (lower.includes("image") || lower.includes("visual")) return Image;
	if (lower.includes("edit") || lower.includes("write") || lower.includes("patch") || lower.includes("diff"))
		return FilePenLine;
	if (lower.includes("read") || lower.includes("file")) return FileSearch;
	if (lower.includes("search") || lower.includes("grep") || lower.includes("glob")) return Search;
	if (lower.includes("bash") || lower.includes("shell") || lower.includes("python") || lower.includes("ipython"))
		return Terminal;
	return Wrench;
}
