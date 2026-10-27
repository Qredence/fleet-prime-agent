import {
	FilePenLine,
	Globe2,
	ListTodo,
	MessageCircleQuestion,
	ShieldCheck,
	Terminal,
	UsersRound,
	Wrench,
} from "lucide-react";
import { describe, expect, it } from "vitest";
import { toolActionIconForName } from "@/components/tools/tool-action-icon";

describe("toolActionIconForName", () => {
	it("uses contextual action icons for common tool and event names", () => {
		expect(toolActionIconForName("PlanWrite")).toBe(ListTodo);
		expect(toolActionIconForName("permission approval")).toBe(ShieldCheck);
		expect(toolActionIconForName("Question")).toBe(MessageCircleQuestion);
		expect(toolActionIconForName("Citations")).toBe(Globe2);
		expect(toolActionIconForName("Agent")).toBe(UsersRound);
		expect(toolActionIconForName("FileEdit")).toBe(FilePenLine);
		expect(toolActionIconForName("Bash")).toBe(Terminal);
		expect(toolActionIconForName("UnknownTool")).toBe(Wrench);
	});
});
