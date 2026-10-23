/**
 * Fleet-owned wire types for the Prime Agent daemon protocol 7.
 *
 * Prime Agent v0.10.x ships the daemon as a native Rust binary whose npm
 * package exports no library types, so the frames and commands Fleet relies on
 * are declared here instead of being imported from `prime-agent`. The shapes
 * are shared by the TypeScript v0.9.8 daemon and the Rust v0.10.1 daemon;
 * Rust-only additions are optional so a v0.9.8 daemon still type-checks.
 *
 * Sources: PA@v0.10.1 (8aac8692) `crates/pa-types/src/daemon/{mod,command,outbound}.rs`
 * and PA@v0.9.8 (7d442aaf) `packages/coding-agent/src/modes/daemon/daemon-protocol.ts`.
 */

export const DAEMON_PROTOCOL_NAME = "prime-agent.daemon";
export const DAEMON_PROTOCOL_VERSION = 7;
export const DAEMON_SCHEMA_REVISION = 30;

/** Schema ids that speak protocol 7 / schema revision 30. */
export const KNOWN_DAEMON_SCHEMA_IDS = {
	typescript: "protocol-7-schema-30-f908f493c9e1",
	rust: "protocol-7-schema-30-8e4b17c2a9f5",
} as const;

/** `runtime.buildId` prefix of the Rust daemon (`pa-daemon-rs-<version>`). */
export const RUST_DAEMON_BUILD_ID_PREFIX = "pa-daemon-rs-";

export type DaemonProtocolInfo = { name: string; version: number };

export type DaemonRuntimeInfo = {
	buildId?: string;
	executablePath?: string;
	entrypointPath?: string;
	launcherPath?: string;
};

/** `daemon_hello`, sent unprompted on every connect. */
export type DaemonHelloFrame = {
	type: "daemon_hello";
	protocol: DaemonProtocolInfo;
	socketPath?: string;
	schemaId?: string;
	schemaRevision?: number;
	appVersion?: string;
	runtime?: DaemonRuntimeInfo;
	clientId?: string;
	serverCapabilities?: string[];
	supervisorGeneration?: string;
	supervisorPid?: number;
	supervisorProcessStartId?: string;
	supervisorSocketPath?: string;
	/** Rust-only: the update-restart resume handshake state. */
	updateResume?: { complete: boolean };
};

export type DaemonErrorInfo = { code: string; [key: string]: unknown };

export type DaemonResponseFrame<T = unknown> = {
	type: "response";
	id?: string;
	command: string;
	success: boolean;
	data?: T;
	error?: string;
	errorInfo?: DaemonErrorInfo;
};

export type DaemonEventCursor = { generation: string; sequence: number };

export type DaemonEventMeta = {
	id?: string;
	activeSessionId?: string;
	sequence?: number;
	cursor?: DaemonEventCursor;
	emittedAt?: string;
	protocol?: DaemonProtocolInfo;
};

/** Wrapper for every per-session agent event. */
export type DaemonSessionEventFrame = {
	type: "session_event";
	activeSessionId: string;
	event: { type: string; [key: string]: unknown };
	meta?: DaemonEventMeta;
};

/**
 * Rust-only, TOP-LEVEL (not inside `session_event`, no `meta`): a worker
 * replacement rebound a session to a new active id. Clients re-target their
 * routing at `activeSessionId`. Live-captured twice per rebind (supersede on
 * create, rebind on a stale-id attach).
 */
export type DaemonSessionBindingFrame = {
	type: "session_binding";
	previousActiveSessionId: string;
	activeSessionId: string;
	sessionId?: string | null;
	sessionFile?: string | null;
};

/** Rust-only broadcast: the served model catalog changed; re-fetch it. */
export type DaemonModelCatalogChangedFrame = { type: "model_catalog_changed" };

export type DaemonSessionSnapshotBeginFrame = {
	type: "session_snapshot_begin";
	activeSessionId: string;
	snapshotId: string;
	purpose?: string;
	messageCount?: number;
	targetChunkBytes?: number;
	snapshot?: unknown;
};

export type DaemonSessionSnapshotChunkFrame = {
	type: "session_snapshot_chunk";
	activeSessionId: string;
	snapshotId: string;
	index: number;
	messages: unknown[];
};

export type DaemonSessionSnapshotEndFrame = {
	type: "session_snapshot_end";
	activeSessionId: string;
	snapshotId: string;
	chunkCount?: number;
	lastEventSequence?: number;
	lastEventCursor?: DaemonEventCursor;
};

export type DaemonSessionClosedFrame = {
	type: "session_closed";
	activeSessionId: string;
	reason: string;
	meta?: DaemonEventMeta;
};

export type DaemonClosingFrame = { type: "daemon_closing"; reason?: string };

/** Any frame Fleet does not model is kept as an opaque typed record. */
export type DaemonUnknownFrame = { type: string; [key: string]: unknown };

export type DaemonOutboundFrame =
	| DaemonHelloFrame
	| DaemonResponseFrame
	| DaemonSessionEventFrame
	| DaemonSessionBindingFrame
	| DaemonModelCatalogChangedFrame
	| DaemonSessionSnapshotBeginFrame
	| DaemonSessionSnapshotChunkFrame
	| DaemonSessionSnapshotEndFrame
	| DaemonSessionClosedFrame
	| DaemonClosingFrame;

/** Session summary row returned by `create`, `get_state`, and `list`. */
export type DaemonSessionSummary = {
	id: string;
	sessionId: string;
	cwd: string;
	activeSessionId?: string;
	sessionFile?: string;
	lifecycle?: string;
	activity?: string;
	name?: string;
	[key: string]: unknown;
};

/** Saved-session row of `list_saved_sessions` (no `allMessagesText` on Rust). */
export type DaemonSavedSessionInfo = {
	path: string;
	id: string;
	cwd: string;
	name?: string;
	parentSessionPath?: string;
	rlmDepth?: number;
	created: string;
	modified: string;
	messageCount: number;
	firstMessage: string;
	/** TS v0.9.8 only. */
	allMessagesText?: string;
	[key: string]: unknown;
};

export type DaemonSavedSessionPage = {
	sessions: DaemonSavedSessionInfo[];
	/** Rust only: files left after this page. */
	remaining?: number;
	/** Rust only: resume cursor for the next page; absent on the last page. */
	nextCursor?: string;
};

export type DaemonSessionLifecycle = "resident" | "client_owned";

/** Create-time session config: only the keys the Rust worker reads. */
export type DaemonCreateConfig = {
	cwd: string;
	sessionDir?: string;
	thinking?: string;
	provider?: string;
	model?: string;
	systemPrompt?: string;
	appendSystemPrompt?: string[];
	skills?: string[];
	promptTemplates?: string[];
	[key: string]: unknown;
};

export type DaemonCreateCommand = {
	type: "create";
	sessionPath?: string;
	noSession?: boolean;
	name?: string;
	config: DaemonCreateConfig;
	/**
	 * Telemetry opt-out. Rust honors ONLY this top-level flag (only ever
	 * `true`; absent means enabled); `config.telemetryDisabled` is ignored.
	 */
	telemetryDisabled?: true;
	lifecycle?: DaemonSessionLifecycle;
	runtimeMetadata?: Record<string, unknown>;
	env?: Record<string, string>;
	launchEnv?: Record<string, string>;
};

export type DaemonListCommand = {
	type: "list";
	all?: boolean;
	cwd?: string;
	sessionDir?: string;
	includeClientOwned?: boolean;
};

export type DaemonListSavedSessionsCommand = {
	type: "list_saved_sessions";
	cwd: string;
	sessionDir?: string;
	scope: "all" | "current";
	/** Rust only (ignored by v0.9.8): most session files folded by this request. */
	limit?: number;
	/** Rust only: a previous page's `nextCursor`. */
	cursor?: string;
};

export type DaemonForkCommand = {
	type: "fork";
	activeSessionId: string;
	entryId: string;
	position?: "before" | "at";
};

export type DaemonForkResult = { cancelled: boolean; selectedText?: string };

export type DaemonKillCommand = { type: "kill"; activeSessionId: string };
export type DaemonDeleteSavedSessionCommand = { type: "delete_saved_session"; sessionPath: string };
export type DaemonAckResultCommand = { type: "ack_result"; commandId: string };

/**
 * `cancel_prompt_admission` outcome. Since v0.10.1 an admission that already
 * became session-owned reports `owned` instead of `cancelled`.
 */
export type DaemonPromptAdmissionCancelStatus = "cancelled" | "owned" | (string & {});

export type DaemonCommandBody =
	| DaemonCreateCommand
	| DaemonListCommand
	| DaemonListSavedSessionsCommand
	| DaemonForkCommand
	| DaemonKillCommand
	| DaemonDeleteSavedSessionCommand
	| DaemonAckResultCommand
	| { type: string; [key: string]: unknown };

export type DaemonCommandEnvelope = {
	type: "command";
	id: string;
	protocol: DaemonProtocolInfo;
	clientId?: string;
	command: DaemonCommandBody & { id?: string };
};

/** Commands that never need an `ack_result` (mirrors TS `READ_ONLY_DAEMON_COMMANDS`). */
export const READ_ONLY_DAEMON_COMMANDS: ReadonlySet<string> = new Set([
	"ack_result",
	"list",
	"list_saved_sessions",
	"list_agent_peers",
	"get_direct_worker_transport",
	"attach",
	"reattach",
	"roster_subscribe",
	"roster_unsubscribe",
	"agent_messages_status",
	"wait_for_idle",
	"get_session_header",
	"get_state",
	"get_connection_state",
	"get_messages",
	"get_rlm_children",
	"get_session_stats",
	"get_context_tree",
	"get_commands",
	"get_resource_snapshot",
	"get_model_catalog",
	"get_available_models",
	"get_queue",
	"cron_list",
	"heartbeats_list",
	"heartbeat_get",
	"get_session_context",
	"get_session_tree",
	"get_user_messages_for_forking",
	"get_last_assistant_text",
	"get_system_prompt",
	"get_rlm_max_depth_status",
	"get_tool_definition",
]);

export function createDaemonCommandEnvelope(
	command: DaemonCommandBody,
	id: string,
	clientId?: string,
): DaemonCommandEnvelope {
	return {
		type: "command",
		id,
		protocol: { name: DAEMON_PROTOCOL_NAME, version: DAEMON_PROTOCOL_VERSION },
		...(clientId ? { clientId } : {}),
		command: { ...command, id },
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse one JSONL line into a frame; malformed or untyped lines yield `undefined`. */
export function parseDaemonFrameLine(line: string): DaemonOutboundFrame | DaemonUnknownFrame | undefined {
	const trimmed = line.trim();
	if (!trimmed) return undefined;
	try {
		const parsed: unknown = JSON.parse(trimmed);
		if (!isRecord(parsed) || typeof parsed.type !== "string") return undefined;
		return parsed as DaemonOutboundFrame | DaemonUnknownFrame;
	} catch {
		return undefined;
	}
}

export function isDaemonHelloFrame(frame: unknown): frame is DaemonHelloFrame {
	return (
		isRecord(frame) &&
		frame.type === "daemon_hello" &&
		isRecord(frame.protocol) &&
		typeof frame.protocol.name === "string" &&
		typeof frame.protocol.version === "number"
	);
}

export function isDaemonResponseFrame(frame: unknown): frame is DaemonResponseFrame {
	return isRecord(frame) && frame.type === "response" && typeof frame.success === "boolean";
}

export function isDaemonSessionBindingFrame(frame: unknown): frame is DaemonSessionBindingFrame {
	return (
		isRecord(frame) &&
		frame.type === "session_binding" &&
		typeof frame.previousActiveSessionId === "string" &&
		typeof frame.activeSessionId === "string"
	);
}

export function isDaemonModelCatalogChangedFrame(frame: unknown): frame is DaemonModelCatalogChangedFrame {
	return isRecord(frame) && frame.type === "model_catalog_changed";
}

export function isDaemonSessionSnapshotFrame(
	frame: unknown,
): frame is DaemonSessionSnapshotBeginFrame | DaemonSessionSnapshotChunkFrame | DaemonSessionSnapshotEndFrame {
	return (
		isRecord(frame) &&
		(frame.type === "session_snapshot_begin" ||
			frame.type === "session_snapshot_chunk" ||
			frame.type === "session_snapshot_end") &&
		typeof frame.snapshotId === "string"
	);
}

export function isDaemonSessionSummary(value: unknown): value is DaemonSessionSummary {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		typeof value.sessionId === "string" &&
		typeof value.cwd === "string"
	);
}

export function isDaemonSavedSessionInfo(value: unknown): value is DaemonSavedSessionInfo {
	return (
		isRecord(value) && typeof value.path === "string" && typeof value.id === "string" && typeof value.cwd === "string"
	);
}

export type DaemonRuntimeFlavor = "rust" | "typescript" | "unknown";

/** Which daemon implementation sent this hello. */
export function daemonRuntimeFlavor(hello: DaemonHelloFrame): DaemonRuntimeFlavor {
	if (hello.runtime?.buildId?.startsWith(RUST_DAEMON_BUILD_ID_PREFIX)) return "rust";
	if (hello.schemaId === KNOWN_DAEMON_SCHEMA_IDS.rust) return "rust";
	if (hello.schemaId === KNOWN_DAEMON_SCHEMA_IDS.typescript) return "typescript";
	return "unknown";
}

/**
 * The daemon Fleet can drive: protocol 7 and, when announced, schema
 * revision 30. Both the pinned TS v0.9.8 and the Rust v0.10.1 daemon pass;
 * a daemon announcing another schema revision is refused.
 */
export function isCompatibleDaemonHello(hello: DaemonHelloFrame): boolean {
	if (hello.protocol.name !== DAEMON_PROTOCOL_NAME || hello.protocol.version !== DAEMON_PROTOCOL_VERSION) return false;
	if (hello.schemaRevision !== undefined && hello.schemaRevision !== DAEMON_SCHEMA_REVISION) return false;
	return true;
}

export function describeDaemonHello(hello: DaemonHelloFrame): string {
	const parts = [`${hello.protocol.name}@${hello.protocol.version}`];
	if (hello.schemaRevision !== undefined) parts.push(`schema ${hello.schemaRevision}`);
	if (hello.runtime?.buildId) parts.push(hello.runtime.buildId);
	return parts.join(", ");
}
