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
	};
};

export type WebAgentConnection = {
	connection: AgentConnection;
	openUIPrompt: WebAgentConnectionOptions["openUIPrompt"];
	/** Present only for the explicit in-process test adapter. */
	session?: AgentSession;
	/** Bind a test-only UI implementation; daemon connections use daemon events. */
	bindUiContext?: (uiContext: ExtensionUIContext) => Promise<void>;
	/** Test-only prompt mutation hook; daemon prompt configuration is fixed at open. */
	setOpenUIPrompt?: (state: WebAgentConnectionOptions["openUIPrompt"]) => void;
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

async function probeDaemon(socketPath: string): Promise<boolean> {
	const client = new DaemonClient(socketPath);
	try {
		await client.connect(DAEMON_PROBE_TIMEOUT_MS);
		const hello = await client.waitForHello(DAEMON_PROBE_TIMEOUT_MS);
		return hello.protocol.version >= DAEMON_PROTOCOL_VERSION;
	} catch {
		return false;
	} finally {
		client.close();
	}
}

async function startDaemon(socketPath: string, spawnCwd: string): Promise<void> {
	if (await probeDaemon(socketPath)) return;

	const child = spawn(process.execPath, [daemonCliEntrypoint(), "--mode", "daemon", "--daemon-socket", socketPath], {
		cwd: spawnCwd,
		detached: true,
		stdio: "ignore",
		env: { ...process.env },
	});
	child.unref();

	const deadline = Date.now() + DAEMON_STARTUP_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (await probeDaemon(socketPath)) return;
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
		await client.waitForHello(DAEMON_PROBE_TIMEOUT_MS);
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

export async function createDaemonWebAgentConnection(options: WebAgentConnectionOptions): Promise<WebAgentConnection> {
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
		const deleteSessionFile: WebAgentConnection["deleteSessionFile"] = async (sessionPath) => {
			const deleteResponse = await client.request({ type: "delete_saved_session", sessionPath });
			if (!deleteResponse.success) throw new Error(deleteResponse.error);
			return deleteResponse.data as Awaited<ReturnType<AgentConnection["deleteSavedSession"]>>;
		};
		return {
			connection,
			openUIPrompt: options.openUIPrompt,
			terminate: async () => {
				const currentState = await connection.getState();
				const currentActiveSessionId = currentState.activeSessionId ?? activeSessionId;
				const killResponse = await client.request({ type: "kill", activeSessionId: currentActiveSessionId });
				if (!killResponse.success) throw new Error(killResponse.error);
			},
			deleteSessionFile,
		};
	} catch (error) {
		client.close();
		throw error;
	}
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
