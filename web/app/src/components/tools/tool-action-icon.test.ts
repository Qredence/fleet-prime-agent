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
import { toolActionIconForName, toolPartDisplayName } from "@/components/tools/tool-action-icon";

describe("toolPartDisplayName", () => {
	it("maps wire IPython parts to the CPython presentation label", () => {
		expect(toolPartDisplayName("tool-IPython")).toBe("CPython");
		expect(toolPartDisplayName("IPython")).toBe("CPython");
		expect(toolPartDisplayName("ipython")).toBe("CPython");
		expect(toolPartDisplayName("tool-Bash")).toBe("Bash");
	});
});

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
