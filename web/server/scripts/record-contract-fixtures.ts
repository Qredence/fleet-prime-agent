/**
 * Record the v0.9.8 daemon-frame contract fixtures
 * (src/__tests__/fixtures/daemon-frames/v0.9.8/).
 *
 * Spawns the pinned stock Prime Agent daemon the way daemon-runtime.ts does
 * (`node <prime-agent>/dist/bundle/cli.js --mode daemon --daemon-socket ...`),
 * but against a throwaway agent dir, HOME, TMPDIR and socket inside a scratch
 * directory, with a scripted faux model provider loaded as an extension. No
 * network, no credentials, nothing under the real ~/.prime.
 *
 * Usage (from web/server):
 *   pnpm run record:contract-fixtures [scenario ...]
 *
 * Environment:
 *   CONTRACT_FIXTURE_SCRATCH  scratch directory (default: web/server/.contract-fixtures-scratch)
 *
 * Every line read from or written to a daemon socket (supervisor and direct
 * worker) is tapped at the `net.Socket` level, so frames are the raw JSONL
 * the adapter saw. Each scenario writes `<scenario>.jsonl` (daemon → client),
 * `<scenario>.commands.jsonl` (client command envelopes) and
 * `<scenario>.events.json` (Fleet ChatStreamEvent output, produced by replaying
 * the scrubbed frames through src/__tests__/daemon-frame-replay.ts).
 * See the set README for scrubbing rules.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { copyFileSync, mkdirSync, openSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { hostname, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, "..");
const repoRoot = resolve(serverRoot, "../..");
const fixturesRoot = join(serverRoot, "src/__tests__/fixtures/daemon-frames/v0.9.8");
const scratch = resolve(process.env.CONTRACT_FIXTURE_SCRATCH ?? join(serverRoot, ".contract-fixtures-scratch"));
const runRoot = join(scratch, "run");
const dirs = {
	home: join(runRoot, "home"),
	agent: join(runRoot, "agent"),
	project: join(runRoot, "project"),
	sessions: join(runRoot, "sessions"),
	tmp: join(runRoot, "tmp"),
};
const socketPath = join(runRoot, "d.sock");
// Unix socket paths are capped at ~104 bytes on macOS; worker sockets live under TMPDIR too.
if (socketPath.length > 80) {
	throw new Error(
		`Scratch path too long for a Unix socket (${socketPath}). Set CONTRACT_FIXTURE_SCRATCH to a short directory.`,
	);
}

// Isolate this process too: prime-agent reads the agent dir from env at import time.
process.env.HOME = dirs.home;
process.env.TMPDIR = dirs.tmp;
process.env.PRIME_AGENT_CODING_AGENT_DIR = dirs.agent;
process.env.PRIME_AGENT_TELEMETRY = "0";
process.env.PI_OFFLINE = "1";
process.env.PI_SKIP_VERSION_CHECK = "1";

const { DaemonAgentConnection, DaemonClient } = await import("prime-agent");
type AgentConnectionEvent = import("prime-agent").AgentConnectionEvent;
type Connection = Awaited<ReturnType<typeof DaemonAgentConnection.attach>>;
const { inferActiveSessionId, replayDaemonFrameScenario } = await import("../src/__tests__/daemon-frame-replay");
type DaemonFrame = import("../src/__tests__/daemon-frame-replay").DaemonFrame;

const sleep = (ms: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function prepareScratch(): void {
	rmSync(runRoot, { recursive: true, force: true });
	for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
	mkdirSync(join(dirs.agent, "extensions"), { recursive: true });
	copyFileSync(
		join(here, "contract-fixtures/scripted-provider-extension.ts"),
		join(dirs.agent, "extensions/fleet-scripted-provider.ts"),
	);
	writeFileSync(
		join(dirs.agent, "settings.json"),
		`${JSON.stringify(
			{
				defaultProvider: "fleet-scripted",
				defaultModel: "scripted-v1",
				defaultThinkingLevel: "low",
				retry: { enabled: true, maxRetries: 2, baseDelayMs: 50 },
				// Keep almost nothing verbatim so a two-turn session is long enough to compact.
				compaction: { enabled: true, keepRecentTokens: 10 },
			},
			null,
			2,
		)}\n`,
	);
}

function startDaemon(): ChildProcess {
	const cli = resolve(dirname(fileURLToPath(import.meta.resolve("prime-agent"))), "bundle", "cli.js");
	const log = openSync(join(scratch, "daemon.log"), "w");
	return spawn(process.execPath, [cli, "--mode", "daemon", "--daemon-socket", socketPath], {
		cwd: dirs.project,
		stdio: ["ignore", log, log],
		env: {
			PATH: process.env.PATH ?? "/usr/bin:/bin",
			HOME: dirs.home,
			TMPDIR: dirs.tmp,
			LANG: "en_US.UTF-8",
			PRIME_AGENT_CODING_AGENT_DIR: dirs.agent,
			PRIME_AGENT_TELEMETRY: "0",
			PI_OFFLINE: "1",
			PI_SKIP_VERSION_CHECK: "1",
		},
	});
}

async function connectClient(): Promise<InstanceType<typeof DaemonClient>> {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		const client = new DaemonClient(socketPath);
		try {
			await client.connect(1_000);
			await client.waitForHello(1_000);
			return client;
		} catch {
			client.close();
			await sleep(100);
		}
	}
	throw new Error(`daemon did not come up; see ${join(scratch, "daemon.log")}`);
}

type ScenarioContext = {
	connection: Connection;
	events: AgentConnectionEvent[];
	waitFor: (predicate: (event: AgentConnectionEvent) => boolean, timeoutMs?: number) => Promise<void>;
};

type Scenario = {
	description: string;
	notes?: string[];
	run: (context: ScenarioContext) => Promise<void>;
};

const isSessionEvent = (type: string) => (event: AgentConnectionEvent) =>
	event.type === "session_event" && event.event.type === type;

const SCENARIOS: Record<string, Scenario> = {
	"normal-turn": {
		description: "One prompt, streamed thinking + text reply, no tools.",
		run: async ({ connection }) => {
			await connection.promptAndWait("[fixture:normal-turn] Say hello.");
		},
	},
	"tool-call": {
		description: "Model calls a custom extension tool (fleet_echo) and then answers.",
		run: async ({ connection }) => {
			await connection.promptAndWait("[fixture:tool-call] Echo ping.");
		},
	},
	"ipython-call": {
		description: "Model calls the built-in `ipython` kernel tool (print(6 * 7)) and then answers.",
		run: async ({ connection }) => {
			await connection.promptAndWait("[fixture:ipython-call] Compute 6 * 7.");
		},
	},
	"cancel-mid-tool": {
		description: "Abort while an `ipython` cell (time.sleep) is executing.",
		run: async ({ connection, waitFor }) => {
			const prompt = connection.promptAndWait("[fixture:cancel-mid-tool] Sleep for a while.").catch(() => undefined);
			await waitFor(isSessionEvent("tool_execution_start"));
			await sleep(1_000);
			await connection.abort();
			await prompt;
			await connection.waitForIdle();
		},
	},
	compaction: {
		description: "One turn, then a manual compaction (compaction_start / compaction_end).",
		run: async ({ connection }) => {
			await connection.promptAndWait("[fixture:compaction] Say something to compact.");
			await connection.promptAndWait("[fixture:compaction] And once more.");
			await connection.compact();
		},
	},
	"auto-retry": {
		description: "First model call fails with a retryable 429; auto_retry_start / auto_retry_end, then success.",
		run: async ({ connection, waitFor }) => {
			await connection.promptAndWait("[fixture:auto-retry] Try until it works.");
			await waitFor(isSessionEvent("agent_end"));
		},
	},
	"queued-steer": {
		description: "A steering message is queued while a tool runs and is delivered at the next turn boundary.",
		run: async ({ connection, waitFor }) => {
			const prompt = connection.promptAndWait("[fixture:queued-steer] Wait, then report.");
			await waitFor(isSessionEvent("tool_execution_start"));
			await connection.steer("[fixture:queued-steer:steer] Also mention the steer.");
			await prompt;
			await connection.waitForIdle();
		},
	},
	"extension-ui": {
		description:
			"Extension tool calls ctx.ui.confirm(); the daemon sends extension_ui_request and the client answers it.",
		notes: ["v0.9.8 baseline, no Rust source: v0.10.1 removed extension_ui_request / extension_ui_response."],
		run: async ({ connection, events, waitFor }) => {
			const prompt = connection.promptAndWait("[fixture:extension-ui] Ask me to confirm.");
			await waitFor((event) => event.type === "extension_ui_request");
			const request = events.find((event) => event.type === "extension_ui_request");
			if (request?.type !== "extension_ui_request") throw new Error("no extension_ui_request");
			await connection.respondToExtensionUiRequest(request.request.id, { confirmed: true });
			await prompt;
		},
	},
	"subagent-spawn": {
		description: "Model spawns an RLM child via rlm.spawn() inside `ipython`; parent sees rlm_child_update frames.",
		run: async ({ connection, waitFor }) => {
			await connection.promptAndWait("[fixture:subagent-spawn] Delegate to a child.");
			await waitFor(
				(event) =>
					event.type === "session_event" &&
					event.event.type === "rlm_child_update" &&
					["done", "error", "cancelled"].includes(
						String((event.event as { child?: { status?: string } }).child?.status),
					),
				20_000,
			).catch(() => undefined);
			await sleep(500);
		},
	},
	"tool-update": {
		description:
			"Extension tool streams two onUpdate() progress results; tool_execution_update / _end carry the same toolCallId as _start.",
		run: async ({ connection }) => {
			await connection.promptAndWait("[fixture:tool-update] Report progress.");
		},
	},
};

// ---------------------------------------------------------------------------
// Socket tap: capture raw JSONL in both directions on every daemon socket.
// ---------------------------------------------------------------------------

type Tap = { inbound: string[]; outbound: string[]; active: boolean };
const tap: Tap = { inbound: [], outbound: [], active: false };

// The direct worker socket speaks Prime Agent's private framing (binary header + JSONL payload),
// so decode it with the package's own decoder. Not exported from the package root: load by path.
const primeAgentDist = dirname(fileURLToPath(import.meta.resolve("prime-agent")));
const { PrivateFrameDecoder } = (await import(
	pathToFileURL(join(primeAgentDist, "modes/session-worker/private-framing.js")).href
)) as {
	PrivateFrameDecoder: new (
		validate: (value: unknown) => boolean,
	) => { push(chunk: Buffer): Iterable<{ header: unknown; payload: Buffer }> };
};

function capture(sink: string[], text: string): void {
	if (!tap.active) return;
	for (const line of text.split("\n")) if (line.trim()) sink.push(line);
}

function lineTap(): (chunk: Buffer | string, sink: string[]) => void {
	let pending = "";
	return (chunk, sink) => {
		pending += chunk.toString();
		const newline = pending.lastIndexOf("\n");
		if (newline < 0) return;
		capture(sink, pending.slice(0, newline));
		pending = pending.slice(newline + 1);
	};
}

function frameTap(): (chunk: Buffer | string, sink: string[]) => void {
	const decoder = new PrivateFrameDecoder(() => true);
	return (chunk, sink) => {
		for (const frame of decoder.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))) {
			capture(sink, frame.payload.toString("utf8"));
		}
	};
}

type SocketTap = {
	inbound: (chunk: Buffer | string, sink: string[]) => void;
	outbound: (chunk: Buffer | string, sink: string[]) => void;
};
const socketTaps = new WeakMap<net.Socket, SocketTap>();

const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function patchedConnect(this: net.Socket, ...args: unknown[]) {
	// net.createConnection() passes its normalized [options, callback] array as the first argument.
	const target = Array.isArray(args[0]) ? args[0][0] : args[0];
	const path = typeof target === "string" ? target : (target as { path?: unknown } | undefined)?.path;
	if (typeof path === "string" && path.startsWith(runRoot) && !socketTaps.has(this)) {
		const framed = path.includes("/worker-");
		const socketTap: SocketTap = framed
			? { inbound: frameTap(), outbound: frameTap() }
			: { inbound: lineTap(), outbound: lineTap() };
		socketTaps.set(this, socketTap);
		this.on("data", (chunk: Buffer | string) => socketTap.inbound(chunk, tap.inbound));
	}
	return (originalConnect as (...connectArgs: unknown[]) => net.Socket).apply(this, args);
} as typeof net.Socket.prototype.connect;

// Writes are dispatched through the stream prototype chain, so tap them there.
const originalWrite = net.Socket.prototype.write;
net.Socket.prototype.write = function patchedWrite(this: net.Socket, data: unknown, ...rest: unknown[]) {
	const socketTap = socketTaps.get(this);
	if (socketTap && (typeof data === "string" || data instanceof Uint8Array)) {
		socketTap.outbound(typeof data === "string" ? data : Buffer.from(data), tap.outbound);
	}
	return (originalWrite as (...writeArgs: unknown[]) => boolean).call(this, data, ...rest);
} as typeof net.Socket.prototype.write;

// ---------------------------------------------------------------------------
// Scrubbing: paths, identity, secrets, ids and timestamps.
// ---------------------------------------------------------------------------

const SECRET_KEY = /(token|secret|password|apikey|api_key|authorization|grantid)/i;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g;
const HEX12 = /\b[0-9a-f]{12}\b/g;
// Short random ids (e.g. `sub-50c75f98`, entry ids); never part of a longer hex run or a UUID segment.
const HEX8 = /(?<![0-9a-f])(?=[0-9]*[a-f])[0-9a-f]{8}(?![0-9a-f-])/g;
const ISO = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g;
const EPOCH_MS_MIN = 1_600_000_000_000;
const EPOCH_MS_MAX = 2_100_000_000_000;

function textReplacements(): Array<[string, string]> {
	const uid = String(process.getuid?.() ?? 0);
	return [
		[dirs.tmp, "/tmp"],
		[dirs.home, "/home/user"],
		[runRoot, "/fixture"],
		[scratch, "/fixture-scratch"],
		[repoRoot, "/repo"],
		[`prime-agent-${uid}`, "prime-agent-<uid>"],
		[userInfo().homedir, "/home/user"],
		[userInfo().username, "user"],
		[hostname(), "host"],
	];
}

function scrubStrings(value: unknown, transform: (text: string) => string, key?: string): unknown {
	if (typeof value === "string") {
		if (key && SECRET_KEY.test(key)) return "<redacted>";
		if (key === "supervisorProcessStartId") return "ps:<start>";
		// Protocol identity is contract data, not a random id: keep it verbatim.
		if (key === "schemaId") return value;
		return transform(value);
	}
	// Process ids and socket inode identity is machine-specific; retry backoff carries random jitter.
	if (typeof value === "number" && (key === "dev" || key === "ino" || /pid$/i.test(key ?? ""))) return 0;
	if (typeof value === "number" && key === "delayMs") return 50;
	if (Array.isArray(value)) return value.map((item) => scrubStrings(item, transform));
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([entryKey, entry]) => [entryKey, scrubStrings(entry, transform, entryKey)]),
		);
	}
	return value;
}

function mapNumbers(value: unknown, transform: (n: number) => number): unknown {
	if (typeof value === "number") return transform(value);
	if (Array.isArray(value)) return value.map((item) => mapNumbers(item, transform));
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, mapNumbers(entry, transform)]));
	}
	return value;
}

/** Deterministically renumber ids and timestamps across one scenario's frames + commands. */
function scrubScenario(records: DaemonFrame[]): DaemonFrame[] {
	const replacements = textReplacements();
	let records2 = records.map(
		(record) =>
			scrubStrings(record, (text) => {
				let out = text;
				for (const [from, to] of replacements) if (from) out = out.split(from).join(to);
				return out;
			}) as DaemonFrame,
	);
	const serialized = JSON.stringify(records2);
	const uuids = [...new Set(serialized.match(UUID) ?? [])];
	const withoutUuids = serialized.replace(UUID, "");
	const hex12 = [...new Set(withoutUuids.match(HEX12) ?? [])];
	const hex8 = [...new Set(withoutUuids.replace(HEX12, "").match(HEX8) ?? [])];
	const isos = [...new Set(serialized.match(ISO) ?? [])].sort();
	const epochs = new Set<number>();
	mapNumbers(records2, (n) => {
		if (Number.isInteger(n) && n >= EPOCH_MS_MIN && n <= EPOCH_MS_MAX) epochs.add(n);
		return n;
	});
	const sortedEpochs = [...epochs].sort((a, b) => a - b);
	const base = Date.UTC(2026, 0, 1);
	const uuidMap = new Map(uuids.map((id, i) => [id, `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`]));
	const hexMap = new Map(hex12.map((id, i) => [id, `f${String(i + 1).padStart(11, "0")}`]));
	const hex8Map = new Map(hex8.map((id, i) => [id, `e${String(i + 1).padStart(7, "0")}`]));
	const isoMap = new Map(isos.map((iso, i) => [iso, new Date(base + (i + 1) * 1000).toISOString()]));
	const epochMap = new Map(sortedEpochs.map((n, i) => [n, base + (i + 1) * 1000]));
	records2 = records2.map(
		(record) =>
			scrubStrings(record, (text) =>
				text
					.replace(UUID, (id) => uuidMap.get(id) ?? id)
					.replace(HEX12, (id) => hexMap.get(id) ?? id)
					.replace(HEX8, (id) => hex8Map.get(id) ?? id)
					.replace(ISO, (iso) => isoMap.get(iso) ?? iso),
			) as DaemonFrame,
	);
	return records2.map((record) => mapNumbers(record, (n) => epochMap.get(n) ?? n) as DaemonFrame);
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

async function recordScenario(
	name: string,
	scenario: Scenario,
): Promise<{ frames: DaemonFrame[]; commands: DaemonFrame[] }> {
	tap.inbound = [];
	tap.outbound = [];
	tap.active = true;
	const client = await connectClient();
	let activeSessionId = "";
	try {
		const response = await client.request({
			type: "create",
			config: { cwd: dirs.project, agentDir: dirs.agent, sessionDir: dirs.sessions, telemetryDisabled: true },
			lifecycle: "resident",
		});
		if (!response.success) throw new Error(`create failed: ${response.error}`);
		const summary = response.data as { id: string; activeSessionId?: string };
		activeSessionId = summary.activeSessionId ?? summary.id;
		// Same attach options as daemon-runtime.ts (minus recoverDaemon, which needs Fleet's daemon lifecycle).
		const connection = await DaemonAgentConnection.attach(client, activeSessionId, {
			closeClientOnDispose: true,
			sendClientEnv: false,
			supportsExtensionUi: true,
		});
		const events: AgentConnectionEvent[] = [];
		const waiters = new Set<() => void>();
		connection.subscribe((event) => {
			events.push(event);
			for (const waiter of waiters) waiter();
		});
		const waitFor: ScenarioContext["waitFor"] = (predicate, timeoutMs = 15_000) =>
			new Promise((resolveWait, rejectWait) => {
				const timer = setTimeout(() => {
					waiters.delete(check);
					rejectWait(new Error(`${name}: timed out waiting for event`));
				}, timeoutMs);
				function check() {
					if (!events.some(predicate)) return;
					waiters.delete(check);
					clearTimeout(timer);
					resolveWait();
				}
				waiters.add(check);
				check();
			});
		try {
			await scenario.run({ connection, events, waitFor });
			await sleep(300);
		} finally {
			tap.active = false;
			await connection.dispose().catch(() => undefined);
		}
	} finally {
		tap.active = false;
		client.close();
		if (activeSessionId) {
			const killer = await connectClient();
			await killer.request({ type: "kill", activeSessionId }).catch(() => undefined);
			killer.close();
		}
	}
	const frames = tap.inbound.map((line) => JSON.parse(line) as DaemonFrame);
	const commands = tap.outbound.map((line) => JSON.parse(line) as DaemonFrame);
	return { frames, commands };
}

function writeJsonl(path: string, records: readonly unknown[]): void {
	writeFileSync(path, records.map((record) => `${JSON.stringify(record)}\n`).join(""));
}

const requested = process.argv.slice(2);
const names = requested.length > 0 ? requested : Object.keys(SCENARIOS);
for (const name of names) if (!SCENARIOS[name]) throw new Error(`unknown scenario ${name}`);

prepareScratch();
mkdirSync(fixturesRoot, { recursive: true });
const daemon = startDaemon();
try {
	for (const name of names) {
		const scenario = SCENARIOS[name];
		if (!scenario) continue;
		process.stdout.write(`recording ${name}... `);
		const raw = await recordScenario(name, scenario);
		const scrubbed = scrubScenario([...raw.frames, ...raw.commands]);
		const frames = scrubbed.slice(0, raw.frames.length);
		const commands = scrubbed.slice(raw.frames.length);
		const activeSessionId = inferActiveSessionId(frames, commands);
		const { events } = await replayDaemonFrameScenario({ frames, activeSessionId });
		writeJsonl(join(fixturesRoot, `${name}.jsonl`), frames);
		writeJsonl(join(fixturesRoot, `${name}.commands.jsonl`), commands);
		writeFileSync(join(fixturesRoot, `${name}.events.json`), `${JSON.stringify(events, null, "\t")}\n`);
		process.stdout.write(`${frames.length} frames, ${commands.length} commands, ${events.length} events\n`);
	}
} finally {
	daemon.kill("SIGTERM");
	net.Socket.prototype.connect = originalConnect;
	net.Socket.prototype.write = originalWrite;
}
process.exit(0);
