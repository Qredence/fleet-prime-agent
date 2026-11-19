import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InputBar } from "@/components/chat/composer/input-bar";

function renderComposer(status: "ready" | "streaming" = "ready") {
	render(
		<InputBar
			models={[]}
			modelKey={undefined}
			status={status}
			onModelChange={vi.fn()}
			onSend={vi.fn()}
			onStop={vi.fn()}
			slashCommands={[{ id: "settings", label: "/settings", value: "/settings" }]}
			workspaceSuggestions={[{ id: "src/a.ts", label: "a.ts", value: "src/a.ts" }]}
		/>,
	);
	return screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement;
}

describe("composer draft and trigger integration", () => {
	it("opens from plus without inserting a slash, then dismisses without changing the draft", async () => {
		const prompt = renderComposer();
		fireEvent.change(prompt, { target: { value: "keep this draft" } });
		fireEvent.click(screen.getByRole("button", { name: "Open slash commands" }));
		expect(screen.getByRole("listbox", { name: "Commands" })).toBeTruthy();
		expect(prompt.value).toBe("keep this draft");
		expect(document.activeElement).toBe(prompt);
		fireEvent.keyDown(prompt, { key: "Escape" });
		await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
		expect(prompt.value).toBe("keep this draft");
	});
	it.each([
		["/sett", "", "Commands"],
		["read src/a.ts and @src/", "read src/a.ts and ", "Workspace references"],
	])("removes the typed trigger on dismissal: %s", async (value, remaining, label) => {
		const prompt = renderComposer();
		fireEvent.change(prompt, { target: { value } });
		expect(screen.getByRole("listbox", { name: label })).toBeTruthy();
		fireEvent.keyDown(prompt, { key: "Escape" });
		await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
		expect(prompt.value).toBe(remaining);
	});
	it("keeps trigger menus closed while streaming", () => {
		const prompt = renderComposer("streaming");
		fireEvent.change(prompt, { target: { value: "/" } });
		expect(screen.queryByRole("listbox")).toBeNull();
		expect((screen.getByRole("button", { name: "Open slash commands" }) as HTMLButtonElement).disabled).toBe(true);
	});
});
