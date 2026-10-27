import { spawn } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { OpenUIPromptMode } from "@prime-agent/web-protocol";
import type { AgentSession, AgentSessionRuntimeConfig, ExtensionUIContext } from "prime-agent";
import type { FleetAgentConnection } from "./agent-connection-port";
import { AGENT_DIR_ENV } from "./agent-dir";
import {
	DAEMON_PROTOCOL_NAME,
	DAEMON_PROTOCOL_VERSION,
	type DaemonCreateCommand,
	type DaemonForkResult,
	type DaemonHelloFrame,
	type DaemonSavedSessionPage,
	type DaemonSessionBindingFrame,
	type DaemonSessionSummary,
	daemonRuntimeFlavor,
	describeDaemonHello,
	describeDaemonIncompatibility,
	isCompatibleDaemonHello,
	isDaemonHelloFrame,
	isDaemonModelCatalogChangedFrame,
	isDaemonSavedSessionInfo,
	isDaemonSessionBindingFrame,
	isDaemonSessionSummary,
} from "./daemon-protocol";
import type { DaemonSequenceGap } from "./daemon-sequence-gap";
import { DaemonSocketClient } from "./daemon-socket-client";
import { FleetDaemonAgentConnection } from "./fleet-daemon-connection";
import { getPrimeConfig } from "./prime-config";
import { ensurePrimeAgentRuntime } from "./prime-runtime";

const DAEMON_STARTUP_TIMEOUT_MS = 30_000;
const DAEMON_PROBE_TIMEOUT_MS = 1_000;
const DAEMON_POLL_DELAY_MS = 50;

const sessionDirEnvironmentNames = ["PRIME_AGENT_SESSION_DIR", "PRIME_AGENT_CODING_AGENT_SESSION_DIR"] as const;

export type WebAgentConnectionOptions = {
	cwd: string;
	sessionPath?: string;
	thinkingLevel?: AgentSessionRuntimeConfig["thinking"];
	openUIPrompt: {
		enabled: boolean;
		mode: OpenUIPromptMode;
		prompt: string;
		artifact?: boolean;
	};
};

export type WebAgentConnection = {
	connection: FleetAgentConnection;
	openUIPrompt: WebAgentConnectionOptions["openUIPrompt"];
	/** Present only for the explicit in-process test adapter. */
	session?: AgentSession;
	/** Bind a test-only UI implementation; daemon connections use daemon events. */
	bindUiContext?: (uiContext: ExtensionUIContext) => Promise<void>;
	/** Reconfigure the daemon worker with the one-shot prompt state. */
	setOpenUIPrompt?: (state: WebAgentConnectionOptions["openUIPrompt"]) => void | Promise<void>;
	/** Kill a daemon worker before deleting its persisted session file. */
	terminate?: () => Promise<void>;
	/** Delete a persisted session through the daemon catalog, without an active-session context. */
	deleteSessionFile?: (sessionPath: string) => ReturnType<FleetAgentConnection["deleteSavedSession"]>;
	/**
	 * Branch the live session at `entryId` into a NEW persisted session through
	 * the daemon `fork` command, then restore the source in its own worker.
	 * Resolves with the forked transcript path; the caller opens it.
	 */
	forkToNewSession?: (entryId: string, position: "before" | "at") => Promise<DaemonForkToNewSessionResult>;
	/** Observe Rust `session_binding` rebinds of this connection's active id. */
	onSessionBinding?: (listener: (binding: DaemonSessionBindingFrame) => void) => () => void;
	/**
	 * Observe `meta.sequence` gaps (lost daemon events) for this connection's
	 * active session, detected on the raw frame channel (daemon-sequence-gap.ts).
	 * The bridge answers with a snapshot resync.
	 */
	onSequenceGap?: (listener: (gap: DaemonSequenceGap) => void) => () => void;
};

export type DaemonForkToNewSessionResult =
	| { cancelled: true; selectedText?: string }
	| { cancelled: false; selectedText?: string; sessionPath: string };

export type WebAgentConnectionFactory = (options: WebAgentConnectionOptions) => Promise<WebAgentConnection>;

const daemonStartupPromises = new Map<string, Promise<void>>();

function delay(ms: number): Promise<void> {
	return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function expandTildePath(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return path;
}

function resolveSessionDirectory(directory: string, cwd: string): string {
	return resolve(cwd, expandTildePath(directory));
}

/**
 * Resolve the same effective store that the CLI uses for persistent sessions.
 * Returning an explicit default prevents a daemon first started with a
 * one-off --session-dir from making that private directory visible to Fleet.
 */
export function sessionDirectoryForCwd(cwd: string): string {
	for (const name of sessionDirEnvironmentNames) {
		const configured = process.env[name];
		if (configured) return resolveSessionDirectory(configured, cwd);
	}
	const settingsDirectory = getPrimeConfig().settingsFor(cwd).getSessionDir();
	if (settingsDirectory) return resolveSessionDirectory(settingsDirectory, cwd);
	return resolve(getPrimeConfig().agentDir, "sessions");
}

function daemonCliEntrypoint(): string {
	const runtimeEntry = fileURLToPath(import.meta.resolve("prime-agent"));
	return resolve(dirname(runtimeEntry), "bundle", "cli.js");
}

/**
 * Opt-in native Prime Agent binary (v0.10.x Rust). When set, Fleet spawns
 * `<bin> --mode daemon --daemon-socket <socket>` directly and never runs the
 * npm migration launcher (which may download an installer).
 */
export const NATIVE_DAEMON_BINARY_ENV = "FLEET_PRIME_AGENT_BIN";

export function daemonSpawnCommand(
	socketPath: string,
	environment: NodeJS.ProcessEnv = process.env,
): { command: string; args: string[] } {
	const nativeBinary = environment[NATIVE_DAEMON_BINARY_ENV];
	if (nativeBinary) return { command: nativeBinary, args: ["--mode", "daemon", "--daemon-socket", socketPath] };
	return {
		command: process.execPath,
		args: [daemonCliEntrypoint(), "--mode", "daemon", "--daemon-socket", socketPath],
	};
}

/**
 * The shared per-user daemon socket, identical for the TS and Rust daemons:
 * `$TMPDIR/prime-agent-<uid>/daemon.sock` (PA@v0.10.1 `crates/pa-daemon/src/platform/paths.rs`).
 */
export function defaultDaemonSocketPath(): string {
	if (process.platform === "win32") return "\\\\.\\pipe\\prime-agent-daemon";
	const suffix = typeof process.getuid === "function" ? String(process.getuid()) : "user";
	return join(tmpdir(), `prime-agent-${suffix}`, "daemon.sock");
}

/**
 * The default daemon socket can already be owned by a daemon started outside
 * Fleet. Accept only protocol 7 / schema revision 30 (the pinned TS v0.9.8
 * daemon or the Rust v0.10.1 daemon) so an unrelated daemon is never mistaken
 * for a compatible one.
 */
function matchesPinnedDaemon(hello: unknown): hello is DaemonHelloFrame {
	return isDaemonHelloFrame(hello) && isCompatibleDaemonHello(hello);
}

function describeHello(hello: unknown): string {
	return isDaemonHelloFrame(hello) ? describeDaemonHello(hello) : "an unrecognized hello";
}

/** One refusal shape for every daemon gate, naming the actual mismatch. */
function refusalMessage(action: string, socketPath: string, hello: unknown): string {
	if (!isDaemonHelloFrame(hello)) {
		return `Refusing to ${action} the Prime Agent daemon at ${socketPath}: it sent ${describeHello(hello)}`;
	}
	const reason = describeDaemonIncompatibility(hello);
	return (
		`Refusing to ${action} the Prime Agent daemon at ${socketPath}: ` +
		`${reason ?? `found ${describeDaemonHello(hello)}`}`
	);
}

type DaemonProbeResult =
	| { status: "compatible" }
	| { status: "incompatible"; detail: string }
	| { status: "unreachable" };

async function probeDaemon(socketPath: string): Promise<DaemonProbeResult> {
	const client = new DaemonSocketClient(socketPath);
	try {
		await client.connect(DAEMON_PROBE_TIMEOUT_MS);
		const hello = await client.waitForHello(DAEMON_PROBE_TIMEOUT_MS);
		if (matchesPinnedDaemon(hello) && daemonRuntimeFlavor(hello) === "rust") return { status: "compatible" };
		return {
			status: "incompatible",
			detail: `found ${describeHello(hello)}, expected ${DAEMON_PROTOCOL_NAME}@${DAEMON_PROTOCOL_VERSION}`,
		};
	} catch {
		return { status: "unreachable" };
	} finally {
		client.close();
	}
}

async function startDaemon(socketPath: string, spawnCwd: string): Promise<void> {
	const initialProbe = await probeDaemon(socketPath);
	if (initialProbe.status === "compatible") return;
	if (initialProbe.status === "incompatible") {
		throw new Error(
			`The Prime Agent daemon socket at ${socketPath} is owned by a non-pinned daemon (${initialProbe.detail}). ` +
				"Stop that daemon or configure a different daemon socket path.",
		);
	}

	const nativeBinary = process.env[NATIVE_DAEMON_BINARY_ENV] || (await ensurePrimeAgentRuntime());
	const { command, args } = daemonSpawnCommand(socketPath, { [NATIVE_DAEMON_BINARY_ENV]: nativeBinary });
	const child = spawn(command, args, {
		cwd: spawnCwd,
		detached: true,
		stdio: "ignore",
		// Sessions no longer carry `config.agentDir` (Rust ignores it), so the
		// daemon itself is pinned to Fleet's agent dir.
		env: { ...process.env, [AGENT_DIR_ENV]: process.env[AGENT_DIR_ENV] || getPrimeConfig().agentDir },
	});
	const spawnErrors: NodeJS.ErrnoException[] = [];
	child.once("error", (error: NodeJS.ErrnoException) => {
		spawnErrors.push(error);
	});
	child.unref();

	const deadline = Date.now() + DAEMON_STARTUP_TIMEOUT_MS;
	while (Date.now() < deadline) {
		let spawnError = spawnErrors[0];
		if (spawnError) {
			throw new Error(
				spawnError.code === "ENOENT"
					? `Prime Agent binary not found: ${command}`
					: `Could not start Prime Agent binary ${command}: ${spawnError.code ?? spawnError.message}`,
			);
		}
		const probe = await probeDaemon(socketPath);
		spawnError = spawnErrors[0];
		if (spawnError) {
			throw new Error(
				spawnError.code === "ENOENT"
					? `Prime Agent binary not found: ${command}`
					: `Could not start Prime Agent daemon: ${spawnError.code || spawnError.message}`,
			);
		}
		if (probe.status === "compatible") return;
		if (probe.status === "incompatible") {
			throw new Error(
				`The Prime Agent daemon socket at ${socketPath} was claimed by a non-pinned daemon (${probe.detail}). ` +
					"Stop that daemon or configure a different daemon socket path.",
			);
		}
		await delay(DAEMON_POLL_DELAY_MS);
	}
	throw new Error("The Prime Agent daemon did not become ready");
}

/** Ensure the shared local Prime daemon exists; failed attempts are retryable. */
export function ensureFleetDaemonRunning(cwd: string, socketPath = defaultDaemonSocketPath()): Promise<void> {
	const existing = daemonStartupPromises.get(socketPath);
	if (existing) return existing;
	const startup = startDaemon(socketPath, cwd).finally(() => {
		if (daemonStartupPromises.get(socketPath) === startup) daemonStartupPromises.delete(socketPath);
	});
	daemonStartupPromises.set(socketPath, startup);
	return startup;
}

async function connectFleetDaemon(cwd: string): Promise<{ client: DaemonSocketClient; socketPath: string }> {
	const socketPath = defaultDaemonSocketPath();
	await ensureFleetDaemonRunning(cwd, socketPath);
	const client = new DaemonSocketClient(socketPath);
	try {
		await client.connect(DAEMON_PROBE_TIMEOUT_MS);
		const hello = await client.waitForHello(DAEMON_PROBE_TIMEOUT_MS);
		if (!matchesPinnedDaemon(hello) || daemonRuntimeFlavor(hello) !== "rust") {
			throw new Error(refusalMessage("attach to", socketPath, hello));
		}
		return { client, socketPath };
	} catch (error) {
		client.close();
		throw error;
	}
}

/**
 * Run supervisor-level commands over Fleet's own protocol-7 socket client
 * (no `prime-agent` client library involved).
 */
async function withDaemonSupervisor<T>(
	cwd: string,
	run: (client: DaemonSocketClient) => Promise<T>,
	socketPath = defaultDaemonSocketPath(),
): Promise<T> {
	await ensureFleetDaemonRunning(cwd, socketPath);
	const client = new DaemonSocketClient(socketPath);
	try {
		await client.connect(DAEMON_PROBE_TIMEOUT_MS);
		const hello = await client.waitForHello(DAEMON_PROBE_TIMEOUT_MS);
		if (!matchesPinnedDaemon(hello) || daemonRuntimeFlavor(hello) !== "rust") {
			throw new Error(refusalMessage("use", socketPath, hello));
		}
		return await run(client);
	} finally {
		client.close();
	}
}

/**
 * The `create` command Fleet sends for every web session.
 *
 * - `telemetryDisabled: true` rides at the TOP level: that is the only flag the
 *   Rust v0.10.1 supervisor honors (`crates/pa-daemon/src/supervisor/worker_lifecycle.rs:334-336`).
 *   The config-level copy stays for the TS v0.9.8 supervisor, which reads only
 *   `config.telemetryDisabled` (`daemon-supervisor.js:2935`); each runtime
 *   ignores the other's key.
 * - `config.agentDir` is not sent (Rust ignores it); the daemon process is
 *   pinned to Fleet's agent dir through `PRIME_AGENT_CODING_AGENT_DIR` instead.
 * - `continueRecent` is never sent (Rust refuses it).
 */
export function buildDaemonCreateCommand(options: {
	cwd: string;
	sessionDir: string;
	sessionPath?: string;
	thinkingLevel?: AgentSessionRuntimeConfig["thinking"];
	openUIPrompt: WebAgentConnectionOptions["openUIPrompt"];
}): DaemonCreateCommand {
	return {
		type: "create",
		...(options.sessionPath ? { sessionPath: options.sessionPath } : {}),
		telemetryDisabled: true,
		config: {
			cwd: options.cwd,
			sessionDir: options.sessionDir,
			telemetryDisabled: true,
			...(options.thinkingLevel ? { thinking: options.thinkingLevel } : {}),
			...(options.openUIPrompt.enabled ? { appendSystemPrompt: [options.openUIPrompt.prompt] } : {}),
		},
		lifecycle: "resident",
	};
}

export type CreatedDaemonSession = { activeSessionId: string; sessionPath?: string };

/** Create a resident daemon session; the worker is attached separately. */
export async function createDaemonSession(
	options: WebAgentConnectionOptions,
	socketPath = defaultDaemonSocketPath(),
): Promise<CreatedDaemonSession> {
	const command = buildDaemonCreateCommand({
		cwd: options.cwd,
		sessionDir: sessionDirectoryForCwd(options.cwd),
		...(options.sessionPath ? { sessionPath: options.sessionPath } : {}),
		...(options.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
		openUIPrompt: options.openUIPrompt,
	});
	return withDaemonSupervisor(
		options.cwd,
		async (client) => {
			const response = await client.request(command);
			if (!response.success || !isDaemonSessionSummary(response.data)) {
				throw new Error(response.success ? "The Prime Agent daemon returned an invalid session" : response.error);
			}
			const sessionPath = response.data.sessionFile ?? options.sessionPath;
			return {
				activeSessionId: response.data.activeSessionId ?? response.data.id,
				...(sessionPath ? { sessionPath } : {}),
			};
		},
		socketPath,
	);
}

type DaemonFrameHook = (frame: unknown) => void;

type OpenedDaemonConnection = {
	connection: FleetAgentConnection;
	activeSessionId: string;
	sessionPath?: string;
	/** Raw daemon frames seen by this connection's socket (session_binding, model_catalog_changed). */
	onFrame: (hook: DaemonFrameHook) => () => void;
	/**
	 * Sequence gaps on this socket. The tracker subscribes before `attach`, so
	 * the attach/snapshot baseline is observed and events dropped between the
	 * snapshot and subscription are caught.
	 */
	onSequenceGap: (hook: (gap: DaemonSequenceGap) => void) => () => void;
};

async function openDaemonConnection(options: WebAgentConnectionOptions): Promise<OpenedDaemonConnection> {
	const created = await createDaemonSession(options);
	const { client, socketPath } = await connectFleetDaemon(options.cwd);
	try {
		const unsubscribeCatalog = client.onFrame((frame: unknown) => {
			if (isDaemonModelCatalogChangedFrame(frame)) notifyDaemonModelCatalogChanged();
		});
		// The adapter owns sequence-gap detection: it observes the raw socket
		// frames before `attach`, which is what establishes the baseline. A second
		// tracker here would duplicate that work on the same frames.
		const connection = await FleetDaemonAgentConnection.attach(client, created.activeSessionId, {
			closeClientOnDispose: true,
			recoverDaemon: () => ensureFleetDaemonRunning(options.cwd, socketPath),
		});
		const dispose = connection.dispose.bind(connection);
		connection.dispose = async () => {
			unsubscribeCatalog();
			await dispose();
		};
		return {
			connection,
			activeSessionId: created.activeSessionId,
			...(created.sessionPath ? { sessionPath: created.sessionPath } : {}),
			onFrame: (hook) => client.onFrame((frame: unknown) => hook(frame)),
			onSequenceGap: (hook) => connection.onSequenceGap(hook),
		};
	} catch (error) {
		client.close();
		throw error;
	}
}

async function killDaemonSession(cwd: string, activeSessionId: string): Promise<void> {
	await withDaemonSupervisor(cwd, async (client) => {
		const response = await client.request({ type: "kill", activeSessionId });
		if (!response.success) throw new Error(response.error);
	});
}

/**
 * Run `work` against a daemon command that requires an `activeSessionId`, using
 * a resident session created for this call and killed afterwards.
 *
 * Several daemon commands (MCP credential writes among them) are session-scoped
 * even though the concern they mutate is not. Fleet's MCP pane is project-global,
 * so there is no live session to reuse. The throwaway session exists only to
 * satisfy that contract; it is killed in `finally` so a failure cannot leak a
 * resident worker.
 */
export async function withTransientDaemonSession<T>(
	cwd: string,
	work: (client: DaemonSocketClient, activeSessionId: string) => Promise<T>,
): Promise<T> {
	const socketPath = defaultDaemonSocketPath();
	await ensureFleetDaemonRunning(cwd, socketPath);
	const client = new DaemonSocketClient(socketPath);
	let activeSessionId: string | undefined;
	try {
		await client.connect(DAEMON_PROBE_TIMEOUT_MS);
		const hello = await client.waitForHello(DAEMON_PROBE_TIMEOUT_MS);
		if (!matchesPinnedDaemon(hello) || daemonRuntimeFlavor(hello) !== "rust") {
			throw new Error(refusalMessage("use", socketPath, hello));
		}
		const created = await createDaemonSession({
			cwd,
			openUIPrompt: { enabled: false, mode: "agent", prompt: "" },
		});
		activeSessionId = created.activeSessionId;
		return await work(client, activeSessionId);
	} finally {
		client.close();
		if (activeSessionId) {
			// Best-effort: a failed kill must not mask the operation's own result.
			await killDaemonSession(cwd, activeSessionId).catch(() => undefined);
		}
	}
}

const modelCatalogListeners = new Set<() => void>();

/**
 * Observe Rust `model_catalog_changed` broadcasts. Fleet's own default
 * listener refreshes the shared in-process ModelRegistry so the next catalog
 * read is fresh.
 */
export function onDaemonModelCatalogChanged(listener: () => void): () => void {
	modelCatalogListeners.add(listener);
	return () => {
		modelCatalogListeners.delete(listener);
	};
}

export function notifyDaemonModelCatalogChanged(): void {
	try {
		getPrimeConfig().modelRegistry.refresh();
	} catch {
		// A stale catalog is recoverable; never break the event stream.
	}
	for (const listener of [...modelCatalogListeners]) {
		try {
			listener();
		} catch {
			// Listener failures stay local.
		}
	}
}

export type DaemonSessionRoute = { activeSessionId: string; sessionPath?: string };

/**
 * Apply a Rust `session_binding` frame to a connection's route. Returns the
 * re-targeted route when the frame concerns this session (its previous id, or
 * the repeat notice for the id it already moved to), else `undefined`.
 */
export function applySessionBinding(route: DaemonSessionRoute, frame: unknown): DaemonSessionRoute | undefined {
	if (!isDaemonSessionBindingFrame(frame)) return undefined;
	if (frame.previousActiveSessionId !== route.activeSessionId && frame.activeSessionId !== route.activeSessionId) {
		return undefined;
	}
	const sessionPath = frame.sessionFile || route.sessionPath;
	return { activeSessionId: frame.activeSessionId, ...(sessionPath ? { sessionPath } : {}) };
}

type ForkableConnection = Pick<FleetAgentConnection, "waitForIdle" | "getState" | "fork">;

export type DaemonWorkerFork =
	| { cancelled: true; selectedText?: string }
	| {
			cancelled: false;
			selectedText?: string;
			sourcePath: string;
			forkedPath: string;
			/** The worker that now holds the FORK (the daemon swaps it in-slot). */
			workerActiveSessionId: string | undefined;
			sourceThinkingLevel: AgentSessionRuntimeConfig["thinking"] | undefined;
	  };

/**
 * Run the daemon `fork` on a live worker. The daemon replaces the worker's
 * session in-slot (PA@v0.10.1 `crates/pa-daemon/src/branch_navigation.rs:567-631`,
 * same as TS `AgentSessionRuntime.fork`), so this reports both paths and the
 * caller restores the source in a fresh worker.
 */
export async function forkInDaemonWorker(
	connection: ForkableConnection,
	entryId: string,
	position: "before" | "at",
	fallbackSourcePath?: string,
): Promise<DaemonWorkerFork> {
	await connection.waitForIdle();
	const sourceState = await connection.getState();
	const sourcePath = sourceState.sessionFile ?? fallbackSourcePath;
	if (!sourcePath) throw new Error("Cannot fork an unpersisted session");
	const result = (await connection.fork(entryId, { position })) as DaemonForkResult;
	if (result.cancelled) {
		return { cancelled: true, ...(result.selectedText !== undefined ? { selectedText: result.selectedText } : {}) };
	}
	const forkState = await connection.getState();
	const forkedPath = forkState.sessionFile;
	if (!forkedPath || forkedPath === sourcePath) throw new Error("Failed to create forked session");
	return {
		cancelled: false,
		...(result.selectedText !== undefined ? { selectedText: result.selectedText } : {}),
		sourcePath,
		forkedPath,
		workerActiveSessionId: forkState.activeSessionId ?? sourceState.activeSessionId,
		sourceThinkingLevel: sourceState.thinkingLevel,
	};
}

type ConnectionEventListener = Parameters<FleetAgentConnection["subscribe"]>[0];
type SessionInvalidationListener = Parameters<FleetAgentConnection["onBeforeSessionInvalidate"]>[0];

/**
 * The daemon protocol fixes appendSystemPrompt when a worker is created. Fleet
 * toggles that prompt per request, so this wrapper reopens the same persisted
 * session between turns and keeps the bridge's subscriptions attached.
 */
function createReconfigurableConnection(
	options: WebAgentConnectionOptions,
	initial: OpenedDaemonConnection,
): {
	connection: FleetAgentConnection;
	setOpenUIPrompt: (state: WebAgentConnectionOptions["openUIPrompt"]) => Promise<void>;
	terminate: () => Promise<void>;
	deleteSessionFile: NonNullable<WebAgentConnection["deleteSessionFile"]>;
	forkToNewSession: NonNullable<WebAgentConnection["forkToNewSession"]>;
	onSessionBinding: NonNullable<WebAgentConnection["onSessionBinding"]>;
	onSequenceGap: NonNullable<WebAgentConnection["onSequenceGap"]>;
} {
	let current = initial.connection;
	let activeSessionId = initial.activeSessionId;
	let sessionPath = initial.sessionPath;
	let openUIPrompt = options.openUIPrompt;
	let disposed = false;
	let reconfigureTail = Promise.resolve();
	const subscriptions: Array<{ listener: ConnectionEventListener; unsubscribe: () => void }> = [];
	const invalidationListeners: Array<{ listener: SessionInvalidationListener; unsubscribe: () => void }> = [];
	const bindingListeners = new Set<(binding: DaemonSessionBindingFrame) => void>();
	const gapListeners = new Set<(gap: DaemonSequenceGap) => void>();

	/**
	 * Rust `session_binding` (top-level frame): a worker replacement rebound
	 * this session to a new active id. The supervisor already re-routes the
	 * stale id for commands and this socket's subscription, so the wrapper
	 * only re-targets its own bookkeeping (kill/terminate/reconfigure).
	 */
	const handleFrame = (frame: unknown) => {
		const next = applySessionBinding({ activeSessionId, ...(sessionPath ? { sessionPath } : {}) }, frame);
		if (!next || !isDaemonSessionBindingFrame(frame)) return;
		activeSessionId = next.activeSessionId;
		sessionPath = next.sessionPath;
		for (const listener of [...bindingListeners]) {
			try {
				listener(frame);
			} catch {
				// Listener failures stay local.
			}
		}
	};
	let unsubscribeFrames = initial.onFrame(handleFrame);

	/** Only gaps on the session this wrapper currently serves (follows session_binding). */
	const handleGap = (gap: DaemonSequenceGap) => {
		if (disposed || gap.activeSessionId !== activeSessionId) return;
		for (const listener of [...gapListeners]) {
			try {
				listener(gap);
			} catch {
				// Listener failures stay local.
			}
		}
	};
	let unsubscribeGaps = initial.onSequenceGap(handleGap);

	const resubscribe = () => {
		for (const subscription of subscriptions) {
			subscription.unsubscribe();
			subscription.unsubscribe = current.subscribe(subscription.listener);
		}
		for (const subscription of invalidationListeners) {
			subscription.unsubscribe();
			subscription.unsubscribe = current.onBeforeSessionInvalidate(subscription.listener);
		}
	};

	/** Detach the bridge listeners so a worker swap's frames never reach them. */
	const suspendSubscriptions = () => {
		for (const subscription of subscriptions) {
			subscription.unsubscribe();
			subscription.unsubscribe = () => undefined;
		}
		for (const subscription of invalidationListeners) {
			subscription.unsubscribe();
			subscription.unsubscribe = () => undefined;
		}
	};

	const adopt = (reopened: OpenedDaemonConnection, fallbackPath: string) => {
		current = reopened.connection;
		activeSessionId = reopened.activeSessionId;
		sessionPath = reopened.sessionPath ?? fallbackPath;
		unsubscribeFrames();
		unsubscribeFrames = reopened.onFrame(handleFrame);
		unsubscribeGaps();
		unsubscribeGaps = reopened.onSequenceGap(handleGap);
		resubscribe();
	};

	const scheduleReconfiguration = (next: WebAgentConnectionOptions["openUIPrompt"]): Promise<void> => {
		const previous = reconfigureTail;
		const operation = previous.then(async () => {
			if (disposed) throw new Error("The Prime Agent connection is disposed");
			await current.waitForIdle();
			const currentState = await current.getState();
			const nextSessionPath = currentState.sessionFile ?? sessionPath;
			if (!nextSessionPath) throw new Error("Cannot reconfigure an unpersisted Prime Agent session");
			const previousActiveSessionId = currentState.activeSessionId ?? activeSessionId;

			await current.dispose();
			await killDaemonSession(options.cwd, previousActiveSessionId);
			const reopened = await openDaemonConnection({
				...options,
				sessionPath: nextSessionPath,
				...(currentState.thinkingLevel ? { thinkingLevel: currentState.thinkingLevel } : {}),
				openUIPrompt: next,
			});
			openUIPrompt = next;
			adopt(reopened, nextSessionPath);
		});
		reconfigureTail = operation.catch(() => undefined);
		return operation;
	};

	/**
	 * Fork through the daemon: the worker swaps to the fork in-slot, so the
	 * forked worker is released and the source reopens in a fresh worker with
	 * the bridge's subscriptions re-attached. No session file is written by Fleet.
	 */
	const forkToNewSession = (entryId: string, position: "before" | "at"): Promise<DaemonForkToNewSessionResult> => {
		const previous = reconfigureTail;
		const operation = previous.then(async (): Promise<DaemonForkToNewSessionResult> => {
			if (disposed) throw new Error("The Prime Agent connection is disposed");
			suspendSubscriptions();
			let forked: DaemonWorkerFork;
			try {
				forked = await forkInDaemonWorker(current, entryId, position, sessionPath);
			} catch (error) {
				resubscribe();
				throw error;
			}
			if (forked.cancelled) {
				resubscribe();
				return forked;
			}
			await current.dispose();
			await killDaemonSession(options.cwd, forked.workerActiveSessionId ?? activeSessionId);
			const reopened = await openDaemonConnection({
				...options,
				sessionPath: forked.sourcePath,
				...(forked.sourceThinkingLevel ? { thinkingLevel: forked.sourceThinkingLevel } : {}),
				openUIPrompt,
			});
			adopt(reopened, forked.sourcePath);
			return {
				cancelled: false,
				...(forked.selectedText !== undefined ? { selectedText: forked.selectedText } : {}),
				sessionPath: forked.forkedPath,
			};
		});
		reconfigureTail = operation.then(
			() => undefined,
			() => undefined,
		);
		return operation;
	};

	const connection = new Proxy({} as FleetAgentConnection, {
		get(_target, property) {
			if (property === "subscribe") {
				return (listener: ConnectionEventListener) => {
					const subscription = { listener, unsubscribe: current.subscribe(listener) };
					subscriptions.push(subscription);
					return () => {
						const index = subscriptions.indexOf(subscription);
						if (index < 0) return;
						subscription.unsubscribe();
						subscriptions.splice(index, 1);
					};
				};
			}
			if (property === "onBeforeSessionInvalidate") {
				return (listener: SessionInvalidationListener) => {
					const subscription = { listener, unsubscribe: current.onBeforeSessionInvalidate(listener) };
					invalidationListeners.push(subscription);
					return () => {
						const index = invalidationListeners.indexOf(subscription);
						if (index < 0) return;
						subscription.unsubscribe();
						invalidationListeners.splice(index, 1);
					};
				};
			}
			if (property === "dispose") {
				return async () => {
					disposed = true;
					await reconfigureTail.catch(() => undefined);
					unsubscribeFrames();
					unsubscribeGaps();
					gapListeners.clear();
					await current.dispose();
				};
			}
			const value = Reflect.get(current, property);
			if (typeof value !== "function") return value;
			return (...args: readonly unknown[]) => Reflect.apply(value, current, args);
		},
	});

	return {
		connection,
		setOpenUIPrompt: scheduleReconfiguration,
		terminate: async () => {
			const currentState = await current.getState();
			await killDaemonSession(options.cwd, currentState.activeSessionId ?? activeSessionId);
		},
		deleteSessionFile: (savedSessionPath) => deleteDaemonSavedSession(options.cwd, savedSessionPath),
		forkToNewSession,
		onSessionBinding: (listener) => {
			bindingListeners.add(listener);
			return () => {
				bindingListeners.delete(listener);
			};
		},
		onSequenceGap: (listener) => {
			gapListeners.add(listener);
			return () => {
				gapListeners.delete(listener);
			};
		},
	};
}

export async function createDaemonWebAgentConnection(options: WebAgentConnectionOptions): Promise<WebAgentConnection> {
	const initial = await openDaemonConnection(options);
	const reconfigurable = createReconfigurableConnection(options, initial);
	return {
		connection: reconfigurable.connection,
		openUIPrompt: options.openUIPrompt,
		setOpenUIPrompt: reconfigurable.setOpenUIPrompt,
		terminate: reconfigurable.terminate,
		deleteSessionFile: reconfigurable.deleteSessionFile,
		forkToNewSession: reconfigurable.forkToNewSession,
		onSessionBinding: reconfigurable.onSessionBinding,
		onSequenceGap: reconfigurable.onSequenceGap,
	};
}

export type DaemonChildPromptHandle = {
	/** Resolves when the prompted turn settles; disposes the borrowed connection. */
	settled: Promise<void>;
	/** Aborts the in-flight turn when one is active; safe to call otherwise. */
	abort: () => Promise<void>;
};

/**
 * Prompt an RLM child session directly, mirroring how the upstream agents
 * view attaches to any agent row (subagents included) for an interactive
 * turn. The connection is borrowed per turn and disposed on settle: the
 * child's managed watcher stream (when open) observes the turn's frames, so
 * callers must not fan the same turn out to a second listener.
 */
export function startDaemonChildPrompt(
	options: {
		cwd: string;
		activeSessionId: string;
		text: string;
		streamingBehavior?: "steer" | "followUp";
	},
	openConnection: (
		cwd: string,
		activeSessionId: string,
	) => Promise<{ connection: FleetAgentConnection; dispose: () => Promise<void> }> = openDaemonChildConnection,
): DaemonChildPromptHandle {
	let connection: FleetAgentConnection | undefined;
	let dispose = async (): Promise<void> => undefined;
	const controller = new AbortController();
	const settled = (async () => {
		const opened = await openConnection(options.cwd, options.activeSessionId);
		connection = opened.connection;
		dispose = opened.dispose;
		try {
			await connection.promptAndWait(options.text, {
				streamingBehavior: options.streamingBehavior ?? "steer",
				queueIfBusy: true,
				signal: controller.signal,
			});
		} finally {
			await dispose().catch(() => undefined);
		}
	})();
	return {
		settled,
		abort: async () => {
			controller.abort();
			await connection?.abort().catch(() => undefined);
		},
	};
}

async function openDaemonChildConnection(
	cwd: string,
	activeSessionId: string,
): Promise<{ connection: FleetAgentConnection; dispose: () => Promise<void> }> {
	const { client, socketPath } = await connectFleetDaemon(cwd);
	try {
		const unsubscribeCatalog = client.onFrame((frame: unknown) => {
			if (isDaemonModelCatalogChangedFrame(frame)) notifyDaemonModelCatalogChanged();
		});
		// A child gets its own Fleet adapter over a shared socket. The adapter
		// filters snapshots by its own active id, so the child's watcher traffic
		// cannot reach the parent's session state.
		const connection = await FleetDaemonAgentConnection.attach(client, activeSessionId, {
			closeClientOnDispose: true,
			recoverDaemon: () => ensureFleetDaemonRunning(cwd, socketPath),
		});
		return {
			connection,
			dispose: async () => {
				unsubscribeCatalog();
				await connection.dispose();
			},
		};
	} catch (error) {
		client.close();
		throw error;
	}
}

/** List the sessions in the configured Prime store through the shared daemon. */
export async function listDaemonSessions(
	cwd?: string,
	socketPath = defaultDaemonSocketPath(),
): Promise<DaemonSessionSummary[]> {
	const effectiveCwd = cwd ?? getPrimeConfig().defaultCwd;
	return withDaemonSupervisor(
		effectiveCwd,
		async (client) => {
			const sessionDir = sessionDirectoryForCwd(effectiveCwd);
			const response = await client.request<{ sessions?: unknown }>({
				type: "list",
				all: true,
				sessionDir,
				...(cwd ? { cwd: resolve(cwd) } : {}),
			});
			if (!response.success) throw new Error(response.error);
			const sessions = response.data?.sessions;
			if (!Array.isArray(sessions) || !sessions.every(isDaemonSessionSummary)) {
				throw new Error("The Prime Agent daemon returned an invalid session list");
			}
			return sessions;
		},
		socketPath,
	);
}

export const SAVED_SESSION_PAGE_SIZE = 200;
const SAVED_SESSION_LIST_TIMEOUT_MS = 120_000;

/**
 * One page of the saved-session catalog (`list_saved_sessions`). The Rust
 * daemon pages by `limit`/`cursor` and reports `nextCursor` + `remaining`;
 * the TS v0.9.8 daemon ignores both and returns everything in one page.
 */
export async function listDaemonSavedSessionsPage(
	options: { cwd: string; scope?: "all" | "current"; limit?: number; cursor?: string },
	socketPath = defaultDaemonSocketPath(),
): Promise<DaemonSavedSessionPage> {
	const cwd = resolve(options.cwd);
	return withDaemonSupervisor(
		cwd,
		async (client) => {
			const response = await client.request<{ sessions?: unknown; nextCursor?: unknown; remaining?: unknown }>(
				{
					type: "list_saved_sessions",
					cwd,
					sessionDir: sessionDirectoryForCwd(cwd),
					scope: options.scope ?? "all",
					limit: options.limit ?? SAVED_SESSION_PAGE_SIZE,
					...(options.cursor ? { cursor: options.cursor } : {}),
				},
				SAVED_SESSION_LIST_TIMEOUT_MS,
			);
			if (!response.success) throw new Error(response.error);
			const data = response.data;
			if (!Array.isArray(data?.sessions) || !data.sessions.every(isDaemonSavedSessionInfo)) {
				throw new Error("The Prime Agent daemon returned an invalid saved-session page");
			}
			return {
				sessions: data.sessions,
				...(typeof data.remaining === "number" ? { remaining: data.remaining } : {}),
				...(typeof data.nextCursor === "string" && data.nextCursor ? { nextCursor: data.nextCursor } : {}),
			};
		},
		socketPath,
	);
}

/** Walk every saved-session page; stops after `maxPages` as a loop guard. */
export async function listAllDaemonSavedSessions(
	options: { cwd: string; scope?: "all" | "current"; pageSize?: number; maxPages?: number },
	listPage: typeof listDaemonSavedSessionsPage = listDaemonSavedSessionsPage,
): Promise<DaemonSavedSessionPage["sessions"]> {
	const rows: DaemonSavedSessionPage["sessions"] = [];
	const maxPages = options.maxPages ?? 50;
	let cursor: string | undefined;
	for (let page = 0; page < maxPages; page++) {
		const result = await listPage({
			cwd: options.cwd,
			...(options.scope ? { scope: options.scope } : {}),
			limit: options.pageSize ?? SAVED_SESSION_PAGE_SIZE,
			...(cursor ? { cursor } : {}),
		});
		rows.push(...result.sessions);
		if (!result.nextCursor || result.nextCursor === cursor) break;
		cursor = result.nextCursor;
	}
	return rows;
}

export type DeleteSavedSessionResult = Awaited<ReturnType<FleetAgentConnection["deleteSavedSession"]>>;

/** Delete a persisted session through the shared daemon catalog, without an active-session context. */
export async function deleteDaemonSavedSession(cwd: string, sessionPath: string): Promise<DeleteSavedSessionResult> {
	return withDaemonSupervisor(cwd, async (client) => {
		const response = await client.request({ type: "delete_saved_session", sessionPath });
		if (!response.success) throw new Error(response.error);
		return response.data as DeleteSavedSessionResult;
	});
}
