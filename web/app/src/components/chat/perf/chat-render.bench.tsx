// Render benchmarks for the Fleet Prime chat surface.
//
// Run: pnpm --filter @qredence/web bench
// (vitest bench only; these files never run under `vitest run`.)
//
// Vitest 5 API: `bench` is a test-context fixture, so each benchmark lives in
// a regular `test()` and must call `.run()` with its tinybench run options.
//
// Numbers are comparative, not absolute: run on the perf branch, then on
// clean main (`git stash -u`), and compare means. happy-dom timings carry
// noise — look for >2x deltas, not single-digit percent moves.
//
// The keystroke bench (#3) intentionally includes a mount per iteration so it
// needs no cross-iteration lifecycle: subtract the mount-only bench (#2) and
// compare THAT delta across branches to isolate keystroke cost.

import type { ChatMessage } from "@prime-agent/web-protocol/chat-types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, test, vi } from "vitest";
import { AgentChat } from "@/components/chat/agent-chat";

vi.mock("@/components/openui/openui-renderer", () => ({
	GenerativeTextRenderer: () => null,
}));

const inputBar = {
	modelKey: undefined,
	models: [],
	onModelChange: vi.fn(),
};

const noop = () => {};

/**
 * Generates a single conversation turn with a user question and assistant
 * response containing text and a tool call.
 *
 * @param index - Turn identifier used to generate unique message IDs and content
 * @returns Array containing user and assistant messages for one conversation turn
 */
function textTurn(index: number): Array<ChatMessage> {
	return [
		{
			id: `user-${index}`,
			role: "user",
			parts: [{ type: "text", text: `Question ${index}: explain the upload flow.` }],
		},
		{
			id: `assistant-${index}`,
			role: "assistant",
			parts: [
				{
					type: "text",
					text: `Answer ${index} with a fenced block:\n\n\`\`\`ts\nconst value_${index} = 42;\n\`\`\``,
				},
				{ type: "tool-Bash", toolCallId: `tool-${index}`, input: { command: `ls ${index}` }, output: "done" },
			],
		},
	];
}

/**
 * Generates a 50-turn conversation for rendering benchmarks.
 *
 * @returns Flattened array of chat messages representing 50 conversation turns
 */
function fiftyTurns(): Array<ChatMessage> {
	return Array.from({ length: 50 }, (_, index) => textTurn(index)).flat();
}

/**
 * Renders the AgentChat component with the provided messages for
 * benchmark testing.
 *
 * @param messages - Chat messages to render
 * @param inputBarOverrides - Optional composer props (e.g. open the model picker during warmup)
 * @returns Testing library render result for the mounted chat component
 */
function renderChat(
	messages: Array<ChatMessage>,
	inputBarOverrides: Partial<typeof inputBar> & { modelPickerOpen?: boolean } = {},
) {
	return render(
		<AgentChat
			inputBar={{ ...inputBar, ...inputBarOverrides }}
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
		await screen.findAllByRole("button", { name: "1 tool action" });
		await waitFor(() => {
			if (warmup.container.querySelectorAll("pre").length === 0) {
				throw new Error("waiting for highlighted code");
			}
		});
		warmup.unmount();
		// The composer's model picker is controlled by its parent, so open it
		// through props to load the lazy cmdk list chunk.
		const welcome = renderChat([], { modelPickerOpen: true });
		await screen.findByPlaceholderText("Search models…", undefined, { timeout: 10_000 });
		welcome.unmount();
	}, 60_000);

	test("welcome mount (empty conversation)", async ({ bench }) => {
		await bench("welcome mount (empty conversation)", () => {
			const view = renderChat([]);
			view.unmount();
		}).run({ time: 500, warmupTime: 200, warmupIterations: 3 });
	});

	test("50-turn conversation mount", async ({ bench }) => {
		await bench("50-turn conversation mount", () => {
			const view = renderChat(fiftyTurns());
			view.unmount();
		}).run({ time: 1000, warmupTime: 300, warmupIterations: 2 });
	});

	let keystroke = 0;
	test("50-turn mount plus one keystroke", async ({ bench }) => {
		await bench("50-turn mount plus one keystroke", () => {
			const view = renderChat(fiftyTurns());
			const composer = view.getByRole("textbox", { name: "Prompt" });
			fireEvent.change(composer, { target: { value: `draft text ${keystroke++}` } });
			view.unmount();
		}).run({ time: 1000, warmupTime: 300, warmupIterations: 2 });
	});
});
