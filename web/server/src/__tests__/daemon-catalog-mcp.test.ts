import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	isDaemonAvailableModels,
	isDaemonMcpConnections,
	isDaemonModel,
	isDaemonModelCatalog,
	isDaemonRemoveMcpConnectionResult,
	isDaemonResourceSnapshot,
	isDaemonSetMcpStaticTokenResult,
	READ_ONLY_DAEMON_COMMANDS,
} from "../daemon-protocol";
import { DaemonCommandError, DaemonSocketClient } from "../daemon-socket-client";
import { type FakeDaemonEnvelope, startFakeDaemon } from "./helpers/fake-daemon";
import { RUST_V0101_FIXTURE_DIR } from "./helpers/rust-fixtures";

type Frame = Record<string, unknown> & { type: string };
type CapturedCommand = { type: string; [key: string]: unknown };
type CapturedResponse = Frame & { id: string; command: string; success: boolean; data?: unknown; error?: string };

const DIR = join(RUST_V0101_FIXTURE_DIR, "catalog-mcp");
const jsonl = (name: string): Frame[] =>
	readFileSync(join(DIR, name), "utf8")
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line) as Frame);

const frames = jsonl("frames.jsonl");
const envelopes = jsonl("commands.jsonl") as unknown as Array<{ id: string; command: CapturedCommand }>;
const errors = JSON.parse(readFileSync(join(DIR, "errors.json"), "utf8")) as Array<{
	label: string;
	command: CapturedCommand;
	response: CapturedResponse;
}>;
const hello = frames.find((frame) => frame.type === "daemon_hello") as Frame;
const responses = new Map(
	frames
		.filter((frame): frame is CapturedResponse => frame.type === "response")
		.map((frame) => [frame.id, frame] as const),
);
/** The captured (command, response) pairs in send order. */
const pairs = envelopes.map((envelope) => ({ command: envelope.command, response: responses.get(envelope.id) }));
const capturedSessionId = String(
	pairs[0]?.response?.data && (pairs[0].response.data as { activeSessionId: string }).activeSessionId,
);

function pairsOf(type: string) {
	return pairs.filter((pair) => pair.command.type === type);
}

function dataOf(type: string, index = 0): unknown {
	return pairsOf(type)[index]?.response?.data;
}

/** A fake daemon that answers each command type with its captured responses, in capture order. */
async function startReplayDaemon(overrides: Record<string, CapturedResponse[]> = {}) {
	const queues = new Map<string, CapturedResponse[]>();
	for (const pair of pairs) {
		if (!pair.response) continue;
		const queue = queues.get(pair.command.type) ?? [];
		queue.push(pair.response);
		queues.set(pair.command.type, queue);
	}
	for (const [type, list] of Object.entries(overrides)) queues.set(type, [...list]);
	return startFakeDaemon({
		hello,
		reply: (envelope: FakeDaemonEnvelope) => {
			if (envelope.command.type === "ack_result") return undefined;
			const next = queues.get(envelope.command.type)?.shift();
			return next ? { ...next, id: envelope.id } : undefined;
		},
	});
}

const FAKE_TOKEN = "fixture-token-not-real";

describe("daemon model validation", () => {
	const model = {
		id: "fixture-chat",
		name: "Fixture Chat",
		api: "openai-completions",
		provider: "fixture-local",
		baseUrl: "http://localhost:9999/v1",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0, output: 1, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8192,
		maxTokens: 1024,
	};

	it("accepts supported inputs and correctly typed optional fields", () => {
		expect(isDaemonModel(model)).toBe(true);
		expect(
			isDaemonModel({
				...model,
				thinkingLevelMap: { off: null, high: "high" },
				maxTokensExplicit: true,
				featured: false,
				headers: { "X-Fixture": "test" },
				compat: { custom: { enabled: true } },
			}),
		).toBe(true);
	});

	it.each(["input", "output", "cacheRead", "cacheWrite"])("validates the %s cost", (field) => {
		for (const invalid of [undefined, null, "0", Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(isDaemonModel({ ...model, cost: { ...model.cost, [field]: invalid } })).toBe(false);
		}
	});

	it.each([
		{ input: ["audio"] },
		{ input: ["text", 1] },
		{ cost: {} },
		{ thinkingLevelMap: null },
		{ thinkingLevelMap: [] },
		{ thinkingLevelMap: { high: true } },
		{ maxTokensExplicit: "true" },
		{ featured: null },
		{ headers: [] },
		{ headers: { "X-Fixture": 1 } },
		{ compat: null },
		{ compat: [] },
	])("rejects malformed model fields: %j", (fields) => {
		const invalid = { ...model, ...fields };
		expect(isDaemonModel(invalid)).toBe(false);
		expect(isDaemonModelCatalog({ models: [invalid], configuredProviders: [] })).toBe(false);
		expect(isDaemonAvailableModels({ models: [invalid] })).toBe(false);
	});
});

describe("rust-v0.10.1 catalog/MCP fixtures", () => {
	it("captured every success payload in the Fleet-owned shapes", () => {
		expect(pairs.every((pair) => pair.response?.success)).toBe(true);
		expect(isDaemonModelCatalog(dataOf("get_model_catalog"))).toBe(true);
		expect(isDaemonAvailableModels(dataOf("get_available_models"))).toBe(true);
		expect(isDaemonResourceSnapshot(dataOf("get_resource_snapshot", 0))).toBe(true);
		expect(isDaemonResourceSnapshot(dataOf("get_resource_snapshot", 1))).toBe(true);
		for (let index = 0; index < 3; index++)
			expect(isDaemonMcpConnections(dataOf("get_mcp_connections", index))).toBe(true);
		expect(isDaemonSetMcpStaticTokenResult(dataOf("set_mcp_static_token"))).toBe(true);
		expect(isDaemonRemoveMcpConnectionResult(dataOf("remove_mcp_connection"))).toBe(true);
	});

	it("advertises the model_catalog server capability", () => {
		expect(hello.serverCapabilities).toContain("model_catalog");
	});

	it("never stores the pasted token in a fixture", () => {
		const command = pairsOf("set_mcp_static_token")[0]?.command;
		expect(command?.token).toBe("<redacted>");
		for (const name of ["frames.jsonl", "commands.jsonl", "errors.json"]) {
			expect(readFileSync(join(DIR, name), "utf8")).not.toContain(FAKE_TOKEN);
		}
	});

	it("rejects malformed payloads", () => {
		expect(isDaemonModelCatalog({ models: [{ id: "x" }], configuredProviders: [] })).toBe(false);
		expect(isDaemonModelCatalog({ models: [] })).toBe(false);
		expect(isDaemonAvailableModels({})).toBe(false);
		expect(isDaemonResourceSnapshot({ contextFiles: [], skills: [], prompts: [], themes: [] })).toBe(false);
		expect(isDaemonMcpConnections({ connections: [], services: [], credentials: [] })).toBe(false);
		expect(isDaemonSetMcpStaticTokenResult({ server: "s", endpoint: "e", verified: false })).toBe(false);
		expect(isDaemonRemoveMcpConnectionResult({ server: "s" })).toBe(false);
	});
});

describe("DaemonSocketClient catalog/resource/MCP wrappers", () => {
	const cleanups: Array<() => Promise<void> | void> = [];
	afterEach(async () => {
		for (const cleanup of cleanups.splice(0)) await cleanup();
	});

	async function connect(overrides?: Record<string, CapturedResponse[]>) {
		const daemon = await startReplayDaemon(overrides);
		cleanups.push(daemon.close);
		const client = new DaemonSocketClient(daemon.socketPath);
		cleanups.push(() => client.close());
		await client.connect(1000);
		await client.waitForHello(1000);
		return { daemon, client };
	}

	const sent = (daemon: { received: FakeDaemonEnvelope[] }) =>
		daemon.received.filter((envelope) => envelope.command.type !== "ack_result");

	it("encodes each command exactly like the captured envelope", async () => {
		const { daemon, client } = await connect();
		const id = capturedSessionId;
		await client.getResourceSnapshot(id);
		await client.getModelCatalog(id);
		await client.getAvailableModels(id);
		await client.getMcpConnections(id);
		await client.setMcpStaticToken(id, "paste-fixture", FAKE_TOKEN);
		await client.removeMcpConnection(id, "paste-fixture");
		const expected = [
			"get_resource_snapshot",
			"get_model_catalog",
			"get_available_models",
			"get_mcp_connections",
			"set_mcp_static_token",
			"remove_mcp_connection",
		].map((type) => pairsOf(type)[0]?.command);
		const actual = sent(daemon).map(({ command }) => {
			const { id: _id, ...rest } = command;
			return rest.type === "set_mcp_static_token" ? { ...rest, token: "<redacted>" } : rest;
		});
		expect(actual).toEqual(expected);
		for (const envelope of sent(daemon)) {
			expect(envelope).toMatchObject({ type: "command", protocol: { name: "prime-agent.daemon", version: 7 } });
			expect(envelope.command.id).toBe(envelope.id);
		}
		expect(sent(daemon).find((envelope) => envelope.command.type === "set_mcp_static_token")?.command.token).toBe(
			FAKE_TOKEN,
		);
	});

	it("parses the captured model catalog and available models", async () => {
		const { client } = await connect();
		const catalog = await client.getModelCatalog(capturedSessionId);
		expect(catalog).toEqual(dataOf("get_model_catalog"));
		expect(catalog.configuredProviders).toEqual(["fixture-local"]);
		const custom = catalog.models.find((model) => model.provider === "fixture-local");
		expect(custom).toMatchObject({ id: "fixture-chat", api: "openai-completions", maxTokensExplicit: true });
		const reasoning = catalog.models.find((model) => model.thinkingLevelMap);
		expect(reasoning?.thinkingLevelMap?.off).toBeNull();
		const available = await client.getAvailableModels(capturedSessionId);
		expect(available.models.map((model) => `${model.provider}/${model.id}`)).toEqual(["fixture-local/fixture-chat"]);
	});

	it("parses the cold (lazy, empty) and warm resource snapshots", async () => {
		const { client } = await connect();
		const cold = await client.getResourceSnapshot(capturedSessionId);
		expect(cold).toEqual({
			contextFiles: [],
			skills: [],
			prompts: [],
			themes: [],
			diagnostics: { skills: [], prompts: [], themes: [] },
		});
		const warm = await client.getResourceSnapshot(capturedSessionId);
		expect(warm).toEqual(dataOf("get_resource_snapshot", 1));
		expect(warm.contextFiles[0]).toMatchObject({
			path: "/fixture/project/AGENTS.md",
			artifact: { type: "context_file" },
		});
		expect(warm.skills.find((skill) => skill.name === "fixture-skill")?.sourceInfo).toMatchObject({
			scope: "user",
			origin: "topLevel",
		});
		expect(warm.prompts[0]).toMatchObject({ name: "fixture-prompt", argumentHint: "<target>" });
		expect(warm.diagnostics.skills[0]).toMatchObject({ type: "warning" });
	});

	it("round-trips set → get → remove → get on the paste fixture", async () => {
		const { daemon, client } = await connect();
		const id = capturedSessionId;
		const card = (view: Awaited<ReturnType<typeof client.getMcpConnections>>) =>
			view.services.find((service) => service.serviceId === "paste-fixture");
		const row = (view: Awaited<ReturnType<typeof client.getMcpConnections>>) =>
			view.connections.find((connection) => connection.server === "paste-fixture");

		const before = await client.getMcpConnections(id);
		expect(card(before)).toMatchObject({ connectionStatus: "setup_required", pasteToken: true, connectionIds: [] });
		expect(before.credentials).toEqual([{ id: "serper", label: "Serper (web search)", configured: false }]);

		const installed = await client.setMcpStaticToken(id, "paste-fixture", FAKE_TOKEN);
		expect(installed).toEqual({
			server: "paste-fixture",
			endpoint: "https://paste-fixture.invalid/mcp",
			verified: false,
			toolCount: null,
			error: "network-unreachable",
		});
		const after = await client.getMcpConnections(id);
		expect(card(after)).toMatchObject({ connectionStatus: "pending", connectionIds: ["paste-fixture"] });
		expect(row(after)).toMatchObject({ connected: true, generic: true });

		expect(await client.removeMcpConnection(id, "paste-fixture")).toEqual({ server: "paste-fixture", removed: true });
		const removed = await client.getMcpConnections(id);
		expect(card(removed)).toMatchObject({ connectionStatus: "setup_required", connectionIds: [] });
		expect(row(removed)).toMatchObject({ connected: false, generic: false });

		// Only the two mutating MCP commands are acknowledged.
		await vi.waitFor(() =>
			expect(daemon.received.filter((envelope) => envelope.command.type === "ack_result")).toHaveLength(2),
		);
		const acked = daemon.received
			.filter((envelope) => envelope.command.type === "ack_result")
			.map((ack) => daemon.received.find((envelope) => envelope.id === ack.command.commandId)?.command.type);
		expect(acked).toEqual(["set_mcp_static_token", "remove_mcp_connection"]);
		expect(READ_ONLY_DAEMON_COMMANDS.has("get_mcp_connections")).toBe(true);
	});

	it.each(errors)("surfaces the captured $label refusal as a DaemonCommandError", async ({ command, response }) => {
		const { client } = await connect({ [command.type]: [response] });
		const session = typeof command.activeSessionId === "string" ? command.activeSessionId : "";
		const server = typeof command.server === "string" ? command.server : "";
		const call = (): Promise<unknown> => {
			switch (command.type) {
				case "get_model_catalog":
					return client.getModelCatalog(session);
				case "get_mcp_connections":
					return client.getMcpConnections(session);
				case "set_mcp_static_token":
					return client.setMcpStaticToken(session, server, FAKE_TOKEN);
				case "remove_mcp_connection":
					return client.removeMcpConnection(session, server);
				default:
					throw new Error(`unexpected fixture command ${command.type}`);
			}
		};
		const error = await call().then(
			() => undefined,
			(caught: unknown) => caught,
		);
		expect(error).toBeInstanceOf(DaemonCommandError);
		expect(error).toMatchObject({ command: command.type, daemonError: response.error, message: response.error });
	});

	it("rejects a success whose payload does not match the shape", async () => {
		const bogus = {
			type: "response",
			id: "x",
			command: "get_model_catalog",
			success: true,
			data: { models: "nope" },
		};
		const { client } = await connect({ get_model_catalog: [bogus as CapturedResponse] });
		await expect(client.getModelCatalog("s")).rejects.toThrow(/invalid "get_model_catalog" payload/);
	});
});
