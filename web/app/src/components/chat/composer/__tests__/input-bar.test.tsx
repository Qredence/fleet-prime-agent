import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentChat } from "@/components/chat/agent-chat";
import { PromptInput } from "@/components/chat/composer/prompt-input";
import { SubagentComposer } from "@/components/chat/subagents/subagent-chat-panel";
import { InputBar } from "@/components/chat/composer/input-bar";

describe("InputBar slash menu control", () => {
	it("renders the open-slash control on the welcome composer path", () => {
		render(
			<InputBar
				modelKey={undefined}
				models={[]}
				onModelChange={vi.fn()}
				onSend={vi.fn()}
				onStop={vi.fn()}
				status="ready"
				placeholder="Ask Prime to build, investigate, or change something…"
				slashCommands={[{ id: "settings", label: "/settings", value: "/settings" }]}
			/>,
		);

		expect(screen.getByRole("button", { name: "Open slash commands" })).toBeTruthy();
		expect(document.querySelector('[data-slot="composer-add"]')).toBeTruthy();
	});

	it("opens the slash menu from plus without changing the prompt value", () => {
		render(
			<InputBar
				modelKey={undefined}
				models={[]}
				onModelChange={vi.fn()}
				onSend={vi.fn()}
				onStop={vi.fn()}
				status="ready"
				slashCommands={[{ id: "settings", label: "/settings", value: "/settings" }]}
			/>,
		);

		const prompt = screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement;
		expect(prompt.value).toBe("");

		fireEvent.click(screen.getByRole("button", { name: "Open slash commands" }));

		expect(prompt.value).toBe("");
		expect(screen.getByRole("listbox", { name: "Commands" })).toBeTruthy();
	});

	it("shows the open-slash control left of Agent on the empty ChatWelcome composer", () => {
		render(
			<AgentChat
				inputBar={{
					modelKey: undefined,
					models: [],
					onModelChange: vi.fn(),
					slashCommands: [{ id: "settings", label: "/settings", value: "/settings" }],
				}}
				messages={[]}
				onSend={vi.fn()}
				onStop={vi.fn()}
				status="ready"
			/>,
		);

		const slashButton = screen.getByRole("button", { name: "Open slash commands" });
		const modeButton = screen.getByRole("button", { name: "Select mode, Agent" });

		expect(slashButton).toBeTruthy();
		expect(slashButton.compareDocumentPosition(modeButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	it("keeps every character when typing into the empty-session composer outside the scroller", () => {
		render(
			<AgentChat
				inputBar={{
					modelKey: undefined,
					models: [],
					onModelChange: vi.fn(),
				}}
				messages={[]}
				onSend={vi.fn()}
				onStop={vi.fn()}
				status="ready"
			/>,
		);

		const prompt = screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement;
		const draft = "type every character of this sentence";
		let value = "";
		for (const char of draft) {
			value += char;
			// Native `input` can precede React's delegated `onChange`. Publishing
			// editing state from `input` used to re-render with a stale controlled
			// value and wipe short keypresses (hold-to-repeat looked like it worked).
			fireEvent.input(prompt, { target: { value } });
			fireEvent.keyUp(prompt, { key: char });
		}

		expect(prompt.value).toBe(draft);
		// Composer is sticky chrome, not nested under the transcript log.
		expect(prompt.closest('[role="log"]')).toBeNull();
	});
});

describe("InputBar attach control", () => {
	function renderBar(props: Partial<React.ComponentProps<typeof InputBar>> = {}) {
		return render(
			<InputBar
				modelKey={undefined}
				models={[]}
				onModelChange={vi.fn()}
				onSend={vi.fn()}
				onStop={vi.fn()}
				status="ready"
				{...props}
			/>,
		);
	}

	it("is absent when the host has no attach handler", () => {
		renderBar();

		expect(screen.queryByRole("button", { name: "Attach files" })).toBeNull();
		expect(document.querySelector('[data-slot="composer-attach"]')).toBeNull();
	});

	it("calls the host handler when pressed", () => {
		const onAttach = vi.fn();
		renderBar({ attachments: { onAttach } });

		fireEvent.click(screen.getByRole("button", { name: "Attach files" }));

		expect(onAttach).toHaveBeenCalledTimes(1);
	});

	it("sits beside the slash control and stays disabled while streaming", () => {
		const onAttach = vi.fn();
		renderBar({ attachments: { onAttach }, status: "streaming" });

		const attach = screen.getByRole("button", { name: "Attach files" }) as HTMLButtonElement;
		const slash = screen.getByRole("button", { name: "Open slash commands" });
		expect(slash.compareDocumentPosition(attach) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(attach.disabled).toBe(true);
	});
});

describe("InputBar prompt ARIA", () => {
	it("announces a list popup without claiming a textbox expansion state", () => {
		render(
			<InputBar
				modelKey={undefined}
				models={[]}
				onModelChange={vi.fn()}
				onSend={vi.fn()}
				onStop={vi.fn()}
				status="ready"
				slashCommands={[{ id: "settings", label: "/settings", value: "/settings" }]}
			/>,
		);

		const prompt = screen.getByRole("textbox", { name: "Prompt" });
		// ARIA 1.2 has no `aria-expanded` on `textbox`; the popup is a listbox.
		expect(prompt.getAttribute("aria-expanded")).toBeNull();
		expect(prompt.getAttribute("aria-haspopup")).toBe("listbox");
		expect(prompt.getAttribute("aria-autocomplete")).toBe("list");
	});

	it("points aria-activedescendant at the highlighted option and aria-controls at the list", () => {
		render(
			<InputBar
				modelKey={undefined}
				models={[]}
				onModelChange={vi.fn()}
				onSend={vi.fn()}
				onStop={vi.fn()}
				status="ready"
				slashCommands={[
					{ id: "settings", label: "/settings", value: "/settings" },
					{ id: "review", label: "/review", value: "/review" },
				]}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Open slash commands" }));

		const prompt = screen.getByRole("textbox", { name: "Prompt" });
		const activeId = prompt.getAttribute("aria-activedescendant");
		expect(activeId).toBeTruthy();
		expect(document.getElementById(activeId ?? "")?.getAttribute("role")).toBe("option");

		const listId = prompt.getAttribute("aria-controls");
		expect(listId).toBeTruthy();
		expect(document.getElementById(listId ?? "")?.getAttribute("role")).toBe("listbox");

		fireEvent.keyDown(prompt, { key: "ArrowDown" });

		expect(prompt.getAttribute("aria-activedescendant")).not.toBe(activeId);
		expect(document.getElementById(prompt.getAttribute("aria-activedescendant") ?? "")?.textContent).toContain(
			"/review",
		);
	});

	it("drops aria-activedescendant once the menu closes", () => {
		render(
			<InputBar
				modelKey={undefined}
				models={[]}
				onModelChange={vi.fn()}
				onSend={vi.fn()}
				onStop={vi.fn()}
				status="ready"
				slashCommands={[{ id: "settings", label: "/settings", value: "/settings" }]}
			/>,
		);

		const prompt = screen.getByRole("textbox", { name: "Prompt" });
		fireEvent.click(screen.getByRole("button", { name: "Open slash commands" }));
		expect(prompt.getAttribute("aria-activedescendant")).toBeTruthy();

		fireEvent.keyDown(prompt, { key: "Escape" });

		expect(prompt.getAttribute("aria-activedescendant")).toBeNull();
		expect(prompt.getAttribute("aria-controls")).toBeNull();
	});
});

describe("shared composer submission and editing", () => {
	function setup(overrides: Partial<React.ComponentProps<typeof InputBar>> = {}) {
		const onSend = vi.fn();
		const onStop = vi.fn();
		const view = render(
			<InputBar
				modelKey={undefined}
				models={[]}
				onModelChange={vi.fn()}
				status="ready"
				onSend={onSend}
				onStop={onStop}
				{...overrides}
			/>,
		);
		return {
			...view,
			onSend,
			onStop,
			prompt: screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement,
		};
	}
	it.each([false, true])("sends once and clears the uncontrolled draft (Alt: %s)", (altKey) => {
		const { prompt, onSend } = setup();
		prompt.focus();
		fireEvent.change(prompt, { target: { value: "  ship it  " } });
		fireEvent.keyDown(prompt, { key: "Enter", altKey });
		expect(onSend).toHaveBeenCalledExactlyOnceWith({ role: "user", content: "ship it", altKey });
		expect(prompt.value).toBe("");
		expect(document.activeElement).toBe(prompt);
	});
	it("allows Shift+Enter and IME Enter without submitting or selecting a command", () => {
		const onSlashCommandSelect = vi.fn();
		const { prompt, onSend } = setup({
			slashCommands: [{ id: "settings", label: "/settings", value: "/settings" }],
			onSlashCommandSelect,
		});
		fireEvent.change(prompt, { target: { value: "/set" } });
		fireEvent.keyDown(prompt, { key: "Enter", shiftKey: true });
		fireEvent.compositionStart(prompt);
		fireEvent.keyDown(prompt, { key: "Enter", isComposing: true });
		expect(prompt.value).toBe("/set");
		expect(onSend).not.toHaveBeenCalled();
		expect(onSlashCommandSelect).not.toHaveBeenCalled();
		fireEvent.compositionEnd(prompt);
	});
	it("consumes local slash submissions without reaching the transport", () => {
		const onLocalSlashSubmit = vi.fn(() => true);
		const { prompt, onSend } = setup({ onLocalSlashSubmit });
		fireEvent.change(prompt, { target: { value: "/settings" } });
		fireEvent.click(screen.getByRole("button", { name: "Send prompt" }));
		expect(onLocalSlashSubmit).toHaveBeenCalledWith("/settings");
		expect(onSend).not.toHaveBeenCalled();
		expect(prompt.value).toBe("");
	});
	it("sends follow-ups while keeping Stop independently available", () => {
		const { prompt, onSend, onStop } = setup({ status: "streaming" });
		fireEvent.change(prompt, { target: { value: "follow up" } });
		fireEvent.click(screen.getByRole("button", { name: "Send follow-up" }));
		expect(onSend).toHaveBeenCalledExactlyOnceWith({ role: "user", content: "follow up", altKey: false });
		fireEvent.click(screen.getByRole("button", { name: "Stop generating" }));
		expect(onStop).toHaveBeenCalledTimes(1);
	});
	it("removes the last workspace reference with Backspace on an empty draft", () => {
		const onRemoveWorkspaceReference = vi.fn();
		const { prompt } = setup({
			workspaceReferences: [{ relativePath: "src/a.ts", kind: "workspace", name: "a.ts" }],
			onRemoveWorkspaceReference,
		});
		fireEvent.keyDown(prompt, { key: "Backspace" });
		expect(onRemoveWorkspaceReference).toHaveBeenCalledWith("src/a.ts");
	});
	it("keeps attachment removal and image preview available", async () => {
		const onRemoveFile = vi.fn();
		const onRemoveImage = vi.fn();
		setup({
			attachments: {
				files: [{ id: "file", filename: "a.ts" }],
				images: [{ id: "image", filename: "a.png", url: "/a.png" }],
				onRemoveFile,
				onRemoveImage,
			},
		});
		fireEvent.click(screen.getByRole("button", { name: "Remove a.ts" }));
		fireEvent.click(screen.getByRole("button", { name: "Remove a.png" }));
		expect(onRemoveFile).toHaveBeenCalledWith("file");
		expect(onRemoveImage).toHaveBeenCalledWith("image");
		fireEvent.click(screen.getByRole("button", { name: "Preview a.png" }));
		expect(await screen.findByRole("dialog")).toBeTruthy();
	});
	it.each(["modelPickerOpen", "effortPickerOpen"] as const)(
		"opens and dismisses the shared picker through %s",
		async (key) => {
			const onModelPickerOpenChange = vi.fn();
			const onEffortPickerOpenChange = vi.fn();
			setup({ [key]: true, onModelPickerOpenChange, onEffortPickerOpenChange });
			await screen.findByPlaceholderText("Search models…");
			fireEvent.keyDown(screen.getByPlaceholderText("Search models…"), { key: "Escape" });
			expect(onModelPickerOpenChange).toHaveBeenCalledWith(false);
			expect(onEffortPickerOpenChange).toHaveBeenCalledWith(false);
		},
	);
	it("opens the model picker without optional controlled open state", async () => {
		setup();
		fireEvent.click(screen.getByRole("combobox", { name: /Select model and reasoning effort/ }));
		expect(await screen.findByPlaceholderText("Search models…")).toBeTruthy();
	});
	it("executes the highlighted command in grouped display order", () => {
		const onSlashCommandSelect = vi.fn();
		const { prompt } = setup({
			onSlashCommandSelect,
			slashCommands: [
				{ id: "one", label: "/one", value: "/one", category: "builtin" },
				{ id: "two", label: "/two", value: "/two", category: "prompt" },
				{ id: "three", label: "/three", value: "/three", category: "builtin" },
			],
		});
		fireEvent.click(screen.getByRole("button", { name: "Open slash commands" }));
		fireEvent.keyDown(prompt, { key: "ArrowDown" });
		const highlighted = screen
			.getAllByRole("option")
			.find((option) => option.getAttribute("aria-selected") === "true");
		expect(highlighted?.textContent).toContain("/three");
		expect(prompt.getAttribute("aria-activedescendant")).toBe(highlighted?.id);
		fireEvent.keyDown(prompt, { key: "Enter" });
		expect(onSlashCommandSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "three" }));
	});
	it.each(["Enter", "Tab"])("does not invoke a disabled suggestion with %s", (key) => {
		const onSlashCommandSelect = vi.fn();
		const { prompt, onSend } = setup({
			onSlashCommandSelect,
			slashCommands: [{ id: "disabled", label: "/disabled", value: "/disabled", disabled: true }],
		});
		fireEvent.click(screen.getByRole("button", { name: "Open slash commands" }));
		fireEvent.keyDown(prompt, { key });
		expect(onSlashCommandSelect).not.toHaveBeenCalled();
		expect(onSend).not.toHaveBeenCalled();
		expect(prompt.value).toBe("");
	});

	it("filters unavailable models and clamps effort on model changes", async () => {
		const onModelChange = vi.fn();
		const onThinkingLevelChange = vi.fn();
		setup({
			modelPickerOpen: true,
			thinkingLevel: "high",
			onModelChange,
			onThinkingLevelChange,
			models: [
				{ id: "local/plain", name: "Plain", provider: "local", modelId: "plain", reasoning: false },
				{ id: "local/hidden", name: "Hidden", provider: "local", modelId: "hidden", available: false },
			],
		});
		fireEvent.click(await screen.findByRole("option", { name: /Plain/ }));
		expect(screen.queryByRole("option", { name: /Hidden/ })).toBeNull();
		expect(onModelChange).toHaveBeenCalledWith("local/plain");
		expect(onThinkingLevelChange).toHaveBeenCalledWith("off");
	});
	it("forwards editing events and keeps resizing independent of ghost text", () => {
		const onScroll = vi.fn();
		const onFocus = vi.fn();
		const onKeyUp = vi.fn();
		const ref = vi.fn();
		const { container, rerender } = render(
			<PromptInput
				value="ship"
				ghostText=" it now"
				onScroll={onScroll}
				onFocus={onFocus}
				onKeyUp={onKeyUp}
				onTextareaRef={ref}
			/>,
		);
		const prompt = screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement;
		const measured = container.querySelector('[data-slot="composer-measure"]');
		expect(measured).toBeTruthy();
		Object.defineProperty(measured, "scrollHeight", { configurable: true, value: 120 });
		Object.defineProperty(prompt, "clientWidth", { configurable: true, value: 240 });
		prompt.scrollTop = 24;
		fireEvent.scroll(prompt);
		fireEvent.focus(prompt);
		fireEvent.keyUp(prompt, { key: "p" });
		expect(ref).toHaveBeenCalledWith(prompt);
		expect(onScroll).toHaveBeenCalledTimes(1);
		expect(onFocus).toHaveBeenCalledTimes(1);
		expect(onKeyUp).toHaveBeenCalledTimes(1);
		const mirror = container.querySelector('[data-slot="composer-ghost-mirror"]') as HTMLDivElement;
		expect(mirror.scrollTop).toBe(24);
		expect(mirror.style.width).toBe("240px");
		rerender(<PromptInput value="ship it" ghostText=" now" />);
		expect(prompt.style.height).toBe("120px");
		Object.defineProperty(measured, "scrollHeight", { configurable: true, value: 400 });
		rerender(<PromptInput value="ship it again" ghostText=" now" />);
		expect(prompt.style.height).toBe("192px");
	});
	it("shares the editor with subagents while blocking submission during a child turn", () => {
		const onSend = vi.fn();
		const onStop = vi.fn();
		const { rerender } = render(<SubagentComposer sending={false} onSend={onSend} onStop={onStop} />);
		const prompt = screen.getByRole("textbox", { name: "Message subagent" }) as HTMLTextAreaElement;
		fireEvent.change(prompt, { target: { value: "steer child" } });
		fireEvent.keyDown(prompt, { key: "Enter" });
		expect(onSend).toHaveBeenCalledExactlyOnceWith("steer child");
		expect(prompt.value).toBe("");
		rerender(<SubagentComposer sending onSend={onSend} onStop={onStop} />);
		fireEvent.change(prompt, { target: { value: "wait for child" } });
		fireEvent.keyDown(prompt, { key: "Enter" });
		expect(onSend).toHaveBeenCalledTimes(1);
		fireEvent.click(screen.getByRole("button", { name: "Stop generating" }));
		expect(onStop).toHaveBeenCalledTimes(1);
	});
});
