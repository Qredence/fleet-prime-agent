/**
 * Scripted model provider used only by `record-contract-fixtures.ts`.
 *
 * The recorder copies this file into a throwaway agent directory, so the
 * stock v0.9.8 daemon worker loads it as a normal extension. It registers a
 * deterministic provider built on pi-ai's faux provider (no network, no
 * credentials) plus a few tools that exercise tool updates and extension UI.
 *
 * Each recorder prompt carries a `[fixture:<scenario>]` tag; the provider
 * answers from the script for that tag, stepping on the number of assistant
 * messages produced since the tagged user message.
 */

import {
	type AssistantMessage,
	type Context,
	fauxAssistantMessage,
	fauxText,
	fauxThinking,
	fauxToolCall,
	getApiProvider,
	registerFauxProvider,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const PROVIDER = "fleet-scripted";
const MODEL_ID = "scripted-v1";
const API = "fleet-scripted-faux";

type Step = () => AssistantMessage;

const SCRIPTS: Record<string, Step[]> = {
	"normal-turn": [
		() =>
			fauxAssistantMessage([fauxThinking("Planning a short reply."), fauxText("Hello from the scripted provider.")]),
	],
	"tool-call": [
		() =>
			fauxAssistantMessage(fauxToolCall("fleet_echo", { text: "ping" }, { id: "call_echo_1" }), {
				stopReason: "toolUse",
			}),
		() => fauxAssistantMessage("The echo tool returned ping."),
	],
	"ipython-call": [
		() =>
			fauxAssistantMessage(fauxToolCall("ipython", { code: "print(6 * 7)" }, { id: "call_ipython_1" }), {
				stopReason: "toolUse",
			}),
		() => fauxAssistantMessage("The kernel printed 42."),
	],
	"cancel-mid-tool": [
		() =>
			fauxAssistantMessage(
				fauxToolCall("ipython", { code: "import time\ntime.sleep(30)\nprint('never')" }, { id: "call_sleep_1" }),
				{ stopReason: "toolUse" },
			),
		() => fauxAssistantMessage("unreachable"),
	],
	compaction: [() => fauxAssistantMessage("First turn before compaction.")],
	"auto-retry": [
		() =>
			fauxAssistantMessage([], {
				stopReason: "error",
				errorMessage: "429 Too Many Requests: rate limit exceeded (scripted)",
			}),
		() => fauxAssistantMessage("Succeeded after retry."),
	],
	"queued-steer": [
		() =>
			fauxAssistantMessage(fauxToolCall("fleet_wait", { ms: 1500 }, { id: "call_wait_1" }), {
				stopReason: "toolUse",
			}),
		() => fauxAssistantMessage("Original task finished."),
	],
	"queued-steer:steer": [() => fauxAssistantMessage("Applied the steering message.")],
	"extension-ui": [
		() =>
			fauxAssistantMessage(
				fauxToolCall("fleet_confirm", { question: "Proceed with the fixture?" }, { id: "call_confirm_1" }),
				{
					stopReason: "toolUse",
				},
			),
		() => fauxAssistantMessage("The user confirmed."),
	],
	"subagent-spawn": [
		() =>
			fauxAssistantMessage(
				fauxToolCall(
					"ipython",
					{
						code: 'child = await rlm.spawn("[fixture:subagent-child] Say done.", name="fixture-child")\nprint("spawned")',
					},
					{ id: "call_spawn_1" },
				),
				{ stopReason: "toolUse" },
			),
		() => fauxAssistantMessage("Spawned the child agent."),
	],
	"subagent-child": [() => fauxAssistantMessage("Child done.")],
	"tool-update": [
		() =>
			fauxAssistantMessage(fauxToolCall("fleet_progress", { steps: 2 }, { id: "call_progress_1" }), {
				stopReason: "toolUse",
			}),
		() => fauxAssistantMessage("Progress tool finished."),
	],
};

// Calls per scenario tag, so a retried request can answer differently.
const callsByTag = new Map<string, number>();

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => (block && typeof block === "object" && "text" in block ? String(block.text) : ""))
		.join("");
}

function respond(context: Context): AssistantMessage {
	const messages = context.messages;
	let tag: string | undefined;
	let tagIndex = -1;
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message?.role !== "user") continue;
		const match = /\[fixture:([a-z0-9:-]+)\]/.exec(textOf(message.content));
		if (match) {
			tag = match[1];
			tagIndex = index;
			break;
		}
	}
	const script = tag ? SCRIPTS[tag] : undefined;
	// Untagged requests (compaction summaries, titles) get a fixed answer.
	if (!tag || !script) return fauxAssistantMessage("Scripted summary of the conversation so far.");
	const calls = (callsByTag.get(tag) ?? 0) + 1;
	callsByTag.set(tag, calls);
	const assistantSteps = messages.slice(tagIndex + 1).filter((message) => message.role === "assistant").length;
	// The auto-retry script is keyed by call count: the failed attempt is not kept in context.
	const stepIndex = tag === "auto-retry" ? Math.min(calls - 1, script.length - 1) : assistantSteps;
	const step = script[Math.min(stepIndex, script.length - 1)];
	return step ? step() : fauxAssistantMessage("Script exhausted.");
}

export default function scriptedProvider(pi: ExtensionAPI) {
	const faux = registerFauxProvider({
		api: API,
		provider: PROVIDER,
		models: [{ id: MODEL_ID, name: "Scripted v1", reasoning: true, input: ["text"] }],
		tokenSize: { min: 4, max: 4 },
	});
	const fauxStream = getApiProvider(API)?.streamSimple;
	if (!fauxStream) throw new Error("faux provider did not register");

	pi.registerProvider(PROVIDER, {
		name: "Fleet scripted (fixtures only)",
		baseUrl: "http://127.0.0.1:9/unused",
		apiKey: "not-a-real-key",
		api: API,
		streamSimple: (model, context, options) => {
			faux.setResponses([(ctx) => respond(ctx)]);
			return fauxStream(model, context, options);
		},
		models: [
			{
				id: MODEL_ID,
				name: "Scripted v1",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 16384,
			},
		],
	});

	pi.registerTool({
		name: "fleet_echo",
		label: "Echo",
		description: "Echo text back (contract fixtures).",
		parameters: Type.Object({ text: Type.String() }),
		async execute(_toolCallId, params) {
			return { content: [{ type: "text", text: params.text }], details: { echoed: params.text } };
		},
	});

	pi.registerTool({
		name: "fleet_progress",
		label: "Progress",
		description: "Emit progress updates (contract fixtures).",
		parameters: Type.Object({ steps: Type.Number() }),
		async execute(_toolCallId, params, _signal, onUpdate) {
			for (let step = 1; step <= params.steps; step++) {
				onUpdate?.({ content: [{ type: "text", text: `step ${step}/${params.steps}` }], details: { step } });
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
			return { content: [{ type: "text", text: "progress complete" }], details: { step: params.steps } };
		},
	});

	pi.registerTool({
		name: "fleet_wait",
		label: "Wait",
		description: "Wait a fixed time (contract fixtures).",
		parameters: Type.Object({ ms: Type.Number() }),
		async execute(_toolCallId, params, signal) {
			await new Promise<void>((resolve) => {
				const timer = setTimeout(resolve, params.ms);
				signal?.addEventListener("abort", () => {
					clearTimeout(timer);
					resolve();
				});
			});
			return { content: [{ type: "text", text: `waited ${params.ms}ms` }], details: {} };
		},
	});

	pi.registerTool({
		name: "fleet_confirm",
		label: "Confirm",
		description: "Ask the user to confirm (contract fixtures).",
		parameters: Type.Object({ question: Type.String() }),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const confirmed = await ctx.ui.confirm("Fixture confirmation", params.question);
			return { content: [{ type: "text", text: confirmed ? "confirmed" : "declined" }], details: { confirmed } };
		},
	});
}
