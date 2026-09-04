// Render benchmarks for the Fleet Prime chat surface.
//
// Run: pnpm --filter @prime-agent/web bench
// (vitest bench only; these files never run under `vitest run`.)
//
// Numbers are comparative, not absolute: run on the perf branch, then on
// clean main (`git stash -u`), and compare means. happy-dom timings carry
// noise — look for >2x deltas, not single-digit percent moves.
//
// The keystroke bench (#3) intentionally includes a mount per iteration so it
// needs no cross-iteration lifecycle: subtract the mount-only bench (#2) and
// compare THAT delta across branches to isolate keystroke cost.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ChatMessage } from "@prime-agent/web-protocol/chat-types";
import { beforeAll, bench, describe, vi } from "vitest";
import { FleetPiAgentChat } from "@prime-agent/web-design/components/product/fleet-pi/chat/fleet-pi-agent-chat";

vi.mock("@prime-agent/web-design/components/openui/inline-renderer", () => ({
	GenerativeTextRenderer: () => null,
}));
vi.mock("@prime-agent/web-design/components/openui/openui-renderer", () => ({
	GenerativeTextRenderer: () => null,
}));

const inputBar = {
	modelKey: undefined,
	models: [],
	onModelChange: vi.fn(),
};

const noop = () => {};

function textTurn(index: number): Array<ChatMessage> {
	return [
		{ id: `user-${index}`, role: "user", parts: [{ type: "text", text: `Question ${index}: explain the upload flow.` }] },
		{
			id: `assistant-${index}`,
			role: "assistant",
			parts: [
				{ type: "text", text: `Answer ${index} with a fenced block:\n\n\`\`\`ts\nconst value_${index} = 42;\n\`\`\`` },
				{ type: "tool-Bash", toolCallId: `tool-${index}`, input: { command: `ls ${index}` }, output: "done" },
			],
		},
	];
}

function fiftyTurns(): Array<ChatMessage> {
	return Array.from({ length: 50 }, (_, index) => textTurn(index)).flat();
}

function renderChat(messages: Array<ChatMessage>) {
	return render(
		<FleetPiAgentChat
			inputBar={inputBar}
			messages={messages}
			onSend={noop}
			onStop={noop}
			status="ready"
		/>,
	);
}

describe("chat render", () => {
	// Warm every async chunk once (activity/timeline/reasoning panels, model
	// list, Shiki highlighting) so timed iterations measure render cost, not
	// first-load fetching.
	beforeAll(async () => {
		const warmup = renderChat(fiftyTurns());
		await screen.findByRole("button", { name: "1 tool action" });
		await waitFor(() => {
			if (warmup.container.querySelectorAll("pre").length === 0) {
				throw new Error("waiting for highlighted code");
			}
		});
		warmup.unmount();
		const welcome = renderChat([]);
		fireEvent.click(screen.getByRole("combobox", { name: "Select model and reasoning effort" }));
		await screen.findByPlaceholderText("Search models…");
		welcome.unmount();
	}, 60_000);

	bench(
		"welcome mount (empty conversation)",
		() => {
			const view = renderChat([]);
			view.unmount();
		},
		{ time: 500, warmupTime: 200, warmupIterations: 3 },
	);

	bench(
		"50-turn conversation mount",
		() => {
			const view = renderChat(fiftyTurns());
			view.unmount();
		},
		{ time: 1000, warmupTime: 300, warmupIterations: 2 },
	);

	let keystroke = 0;
	bench(
		"50-turn mount plus one keystroke",
		() => {
			const view = renderChat(fiftyTurns());
			const composer = view.getByRole("textbox", { name: "Prompt" });
			fireEvent.change(composer, { target: { value: `draft text ${keystroke++}` } });
			view.unmount();
		},
		{ time: 1000, warmupTime: 300, warmupIterations: 2 },
	);
});
