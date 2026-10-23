import { describe, expect, it } from "vitest";
import {
	createDaemonCommandEnvelope,
	DAEMON_PROTOCOL_NAME,
	type DaemonHelloFrame,
	daemonRuntimeFlavor,
	isCompatibleDaemonHello,
	isDaemonHelloFrame,
	isDaemonModelCatalogChangedFrame,
	isDaemonSessionBindingFrame,
	isDaemonSessionSnapshotFrame,
	isDaemonSessionSummary,
	KNOWN_DAEMON_SCHEMA_IDS,
	parseDaemonFrameLine,
} from "../daemon-protocol";
import { readRustFixture, readRustFixtureLines } from "./helpers/rust-fixtures";

describe("daemon protocol 7 types against the Rust v0.10.1 fixtures", () => {
	it("parses every captured frame line", () => {
		for (const name of [
			"daemon-hello.jsonl",
			"real-turn-python-repl.jsonl",
			"session-binding.jsonl",
			"tool-execution-nameless.jsonl",
			"model-catalog-changed.jsonl",
		]) {
			for (const line of readRustFixtureLines(name)) {
				expect(parseDaemonFrameLine(line)?.type).toEqual(expect.any(String));
			}
		}
		expect(parseDaemonFrameLine("not json")).toBeUndefined();
		expect(parseDaemonFrameLine('{"no":"type"}')).toBeUndefined();
		expect(parseDaemonFrameLine("   ")).toBeUndefined();
	});

	it("recognizes the Rust hello, including buildId and updateResume", () => {
		const [hello] = readRustFixture("daemon-hello.jsonl");
		expect(isDaemonHelloFrame(hello)).toBe(true);
		const frame = hello as unknown as DaemonHelloFrame;
		expect(frame.schemaId).toBe(KNOWN_DAEMON_SCHEMA_IDS.rust);
		expect(frame.runtime?.buildId).toBe("pa-daemon-rs-0.10.1");
		expect(frame.updateResume).toEqual({ complete: true });
		expect(frame.serverCapabilities).not.toContain("extension_ui");
		expect(daemonRuntimeFlavor(frame)).toBe("rust");
		expect(isCompatibleDaemonHello(frame)).toBe(true);
	});

	it("accepts the TS v0.9.8 hello and refuses another protocol or schema revision", () => {
		const ts: DaemonHelloFrame = {
			type: "daemon_hello",
			protocol: { name: DAEMON_PROTOCOL_NAME, version: 7 },
			schemaRevision: 30,
			schemaId: KNOWN_DAEMON_SCHEMA_IDS.typescript,
		};
		expect(daemonRuntimeFlavor(ts)).toBe("typescript");
		expect(isCompatibleDaemonHello(ts)).toBe(true);
		expect(isCompatibleDaemonHello({ ...ts, schemaRevision: 31 })).toBe(false);
		expect(isCompatibleDaemonHello({ ...ts, protocol: { name: DAEMON_PROTOCOL_NAME, version: 8 } })).toBe(false);
		expect(isCompatibleDaemonHello({ ...ts, protocol: { name: "other", version: 7 } })).toBe(false);
		expect(daemonRuntimeFlavor({ type: "daemon_hello", protocol: ts.protocol })).toBe("unknown");
	});

	it("finds session_binding as a top-level frame, never inside session_event", () => {
		const frames = readRustFixture("session-binding.jsonl");
		const bindings = frames.filter(isDaemonSessionBindingFrame);
		expect(bindings).toHaveLength(2);
		for (const binding of bindings) {
			expect(binding.previousActiveSessionId).toBe("61506e70f987");
			expect(binding.activeSessionId).toBe("fb0bae7caf80");
			expect(binding.sessionFile).toMatch(/\.jsonl$/);
			expect(binding).not.toHaveProperty("meta");
		}
		const nested = frames.filter(
			(frame) => frame.type === "session_event" && (frame.event as { type?: string }).type === "session_binding",
		);
		expect(nested).toHaveLength(0);
	});

	it("recognizes model_catalog_changed and the chunked snapshot frames", () => {
		const [catalog] = readRustFixture("model-catalog-changed.jsonl");
		expect(isDaemonModelCatalogChangedFrame(catalog)).toBe(true);
		const snapshotTypes = readRustFixture("session-binding.jsonl")
			.filter(isDaemonSessionSnapshotFrame)
			.map((frame) => frame.type);
		expect(snapshotTypes).toEqual(["session_snapshot_begin", "session_snapshot_chunk", "session_snapshot_end"]);
	});

	it("reads the create response as a session summary", () => {
		const create = readRustFixture("real-turn-python-repl.jsonl").find(
			(frame) => frame.type === "response" && frame.command === "create",
		);
		expect(isDaemonSessionSummary(create?.data)).toBe(true);
	});

	it("builds the protocol-7 command envelope with the id on both levels", () => {
		expect(createDaemonCommandEnvelope({ type: "kill", activeSessionId: "a1" }, "fleet_1", "client-1")).toEqual({
			type: "command",
			id: "fleet_1",
			protocol: { name: DAEMON_PROTOCOL_NAME, version: 7 },
			clientId: "client-1",
			command: { type: "kill", activeSessionId: "a1", id: "fleet_1" },
		});
	});
});
