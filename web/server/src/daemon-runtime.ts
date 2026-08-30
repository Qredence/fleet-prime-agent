import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { OpenUIPromptMode } from "@prime-agent/web-protocol";
import type { ExtensionUIContext } from "prime-agent";
import {
	type AgentConnection,
	type AgentSession,
	type AgentSessionRuntimeConfig,
	DAEMON_PROTOCOL_NAME,
	DAEMON_PROTOCOL_VERSION,
	DaemonAgentConnection,
	DaemonClient,
	defaultDaemonSocketPath,
	type SessionSummary,
} from "prime-agent";
import { getPrimeConfig } from "./prime-config";

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
	connection: AgentConnection;
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
	deleteSessionFile?: (sessionPath: string) => ReturnType<AgentConnection["deleteSavedSession"]>;
};

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

type DaemonHello = Awaited<ReturnType<DaemonClient["waitForHello"]>>;

/**
 * The default daemon socket can already be owned by a daemon started outside
 * Fleet. Accept only the exact protocol identity pinned by this runtime so a
 * newer or unrelated daemon is never mistaken for the pinned one.
 */
function matchesPinnedDaemon(hello: DaemonHello): boolean {
	return hello.protocol.name === DAEMON_PROTOCOL_NAME && hello.protocol.version === DAEMON_PROTOCOL_VERSION;
}

type DaemonProbeResult =
	| { status: "compatible" }
	| { status: "incompatible"; detail: string }
	| { status: "unreachable" };

async function probeDaemon(socketPath: string): Promise<DaemonProbeResult> {
	const client = new DaemonClient(socketPath);
	try {
		await client.connect(DAEMON_PROBE_TIMEOUT_MS);
		const hello = await client.waitForHello(DAEMON_PROBE_TIMEOUT_MS);
		if (matchesPinnedDaemon(hello)) return { status: "compatible" };
		return {
			status: "incompatible",
			detail: `found ${hello.protocol.name}@${hello.protocol.version}, expected ${DAEMON_PROTOCOL_NAME}@${DAEMON_PROTOCOL_VERSION}`,
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

	const child = spawn(process.execPath, [daemonCliEntrypoint(), "--mode", "daemon", "--daemon-socket", socketPath], {
		cwd: spawnCwd,
		detached: true,
		stdio: "ignore",
		env: { ...process.env },
	});
	child.unref();

	const deadline = Date.now() + DAEMON_STARTUP_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const probe = await probeDaemon(socketPath);
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

async function connectFleetDaemon(cwd: string): Promise<{ client: DaemonClient; socketPath: string }> {
	const socketPath = defaultDaemonSocketPath();
	await ensureFleetDaemonRunning(cwd, socketPath);
	const client = new DaemonClient(socketPath);
	try {
		await client.connect(DAEMON_PROBE_TIMEOUT_MS);
		const hello = await client.waitForHello(DAEMON_PROBE_TIMEOUT_MS);
		if (!matchesPinnedDaemon(hello)) {
			throw new Error(
				`Refusing to attach to the Prime Agent daemon at ${socketPath}: expected protocol ` +
					`${DAEMON_PROTOCOL_NAME}@${DAEMON_PROTOCOL_VERSION}, found ${hello.protocol.name}@${hello.protocol.version}`,
			);
		}
		return { client, socketPath };
	} catch (error) {
		client.close();
		throw error;
	}
}

function isSessionSummary(value: unknown): value is SessionSummary {
	if (!value || typeof value !== "object") return false;
	const candidate = value as { id?: unknown; sessionId?: unknown; cwd?: unknown };
	return (
		typeof candidate.id === "string" && typeof candidate.sessionId === "string" && typeof candidate.cwd === "string"
	);
}

function runtimeConfig(
	cwd: string,
	thinkingLevel: AgentSessionRuntimeConfig["thinking"] | undefined,
	openUIPrompt: WebAgentConnectionOptions["openUIPrompt"],
): AgentSessionRuntimeConfig {
	const sessionDir = sessionDirectoryForCwd(cwd);
	return {
		cwd,
		agentDir: getPrimeConfig().agentDir,
		sessionDir,
		telemetryDisabled: true,
		...(thinkingLevel ? { thinking: thinkingLevel } : {}),
		...(openUIPrompt.enabled ? { appendSystemPrompt: [openUIPrompt.prompt] } : {}),
	};
}

type OpenedDaemonConnection = {
	connection: AgentConnection;
	activeSessionId: string;
	sessionPath?: string;
};

async function openDaemonConnection(options: WebAgentConnectionOptions): Promise<OpenedDaemonConnection> {
	const { client, socketPath } = await connectFleetDaemon(options.cwd);
	try {
		const response = await client.request({
			type: "create",
			...(options.sessionPath ? { sessionPath: options.sessionPath } : {}),
			config: runtimeConfig(options.cwd, options.thinkingLevel, options.openUIPrompt),
			lifecycle: "resident",
		});
		if (!response.success || !isSessionSummary(response.data)) {
			throw new Error(response.success ? "The Prime Agent daemon returned an invalid session" : response.error);
		}
		const activeSessionId = response.data.activeSessionId ?? response.data.id;
		const connection = await DaemonAgentConnection.attach(client, activeSessionId, {
			closeClientOnDispose: true,
			recoverDaemon: () => ensureFleetDaemonRunning(options.cwd, socketPath),
			sendClientEnv: false,
			supportsExtensionUi: true,
		});
		return {
			connection,
			activeSessionId,
			...(response.data.sessionFile || options.sessionPath
				? { sessionPath: response.data.sessionFile ?? options.sessionPath }
				: {}),
		};
	} catch (error) {
		client.close();
		throw error;
	}
}

async function killDaemonSession(cwd: string, activeSessionId: string): Promise<void> {
	const { client } = await connectFleetDaemon(cwd);
	try {
		const response = await client.request({ type: "kill", activeSessionId });
		if (!response.success) throw new Error(response.error);
	} finally {
		client.close();
	}
}

type ConnectionEventListener = Parameters<AgentConnection["subscribe"]>[0];
type SessionInvalidationListener = Parameters<AgentConnection["onBeforeSessionInvalidate"]>[0];

/**
 * The daemon protocol fixes appendSystemPrompt when a worker is created. Fleet
 * toggles that prompt per request, so this wrapper reopens the same persisted
 * session between turns and keeps the bridge's subscriptions attached.
 */
function createReconfigurableConnection(
	options: WebAgentConnectionOptions,
	initial: OpenedDaemonConnection,
): {
	connection: AgentConnection;
	setOpenUIPrompt: (state: WebAgentConnectionOptions["openUIPrompt"]) => Promise<void>;
	terminate: () => Promise<void>;
	deleteSessionFile: NonNullable<WebAgentConnection["deleteSessionFile"]>;
} {
	let current = initial.connection;
	let activeSessionId = initial.activeSessionId;
	let sessionPath = initial.sessionPath;
	let disposed = false;
	let reconfigureTail = Promise.resolve();
	const subscriptions: Array<{ listener: ConnectionEventListener; unsubscribe: () => void }> = [];
	const invalidationListeners: Array<{ listener: SessionInvalidationListener; unsubscribe: () => void }> = [];

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
			current = reopened.connection;
			activeSessionId = reopened.activeSessionId;
			sessionPath = reopened.sessionPath ?? nextSessionPath;
			resubscribe();
		});
		reconfigureTail = operation.catch(() => undefined);
		return operation;
	};

	const connection = new Proxy({} as AgentConnection, {
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
	};
}

/** List the sessions in the configured Prime store through the shared daemon. */
export async function listDaemonSessions(cwd?: string): Promise<SessionSummary[]> {
	const effectiveCwd = cwd ?? getPrimeConfig().defaultCwd;
	const { client } = await connectFleetDaemon(effectiveCwd);
	try {
		const sessionDir = sessionDirectoryForCwd(effectiveCwd);
		const response = await client.request({
			type: "list",
			all: true,
			sessionDir,
			...(cwd ? { cwd: resolve(cwd) } : {}),
		});
		if (!response.success) throw new Error(response.error);
		const data = response.data as { sessions?: unknown } | undefined;
		if (!Array.isArray(data?.sessions) || !data.sessions.every(isSessionSummary)) {
			throw new Error("The Prime Agent daemon returned an invalid session list");
		}
		return data.sessions;
	} finally {
		client.close();
	}
}

export type DeleteSavedSessionResult = Awaited<ReturnType<AgentConnection["deleteSavedSession"]>>;

/** Delete a persisted session through the shared daemon catalog, without an active-session context. */
export async function deleteDaemonSavedSession(cwd: string, sessionPath: string): Promise<DeleteSavedSessionResult> {
	const { client } = await connectFleetDaemon(cwd);
	try {
		const response = await client.request({ type: "delete_saved_session", sessionPath });
		if (!response.success) throw new Error(response.error);
		return response.data as DeleteSavedSessionResult;
	} finally {
		client.close();
	}
}
