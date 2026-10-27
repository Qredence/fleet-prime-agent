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

/**
 * Top-level broadcast (no `meta`, no payload) after heartbeat/cron changes,
 * e.g. right after a kill. Consumers refetch heartbeats/cron themselves.
 */
export type DaemonHeartbeatsChangedFrame = { type: "heartbeats_changed" };

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
	sessionName?: string;
	isSessionActive?: boolean;
	isStreaming?: boolean;
	hasRunningRlmChildren?: boolean;
	parentActiveSessionId?: string;
	parentSessionId?: string;
	parentSessionPath?: string;
	rlmChildId?: string;
	statusLabel?: string;
	workerState?: string;
	lastHeardFromAt?: string;
	thinkingLevel?: string;
	summary?: string;
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

/**
 * Session-routed catalog, resource and MCP commands. Every one of them is a
 * worker command: `activeSessionId` is REQUIRED (a missing selector is the
 * supervisor's "malformed <type> command" refusal, an unknown one is
 * "Unknown active session: <id>"), and the worker answers "Session is still
 * initializing" until the session is created.
 * PA@v0.10.1 `crates/pa-types/src/daemon/command.rs:696-752`.
 */
export type DaemonGetModelCatalogCommand = { type: "get_model_catalog"; activeSessionId: string };
export type DaemonGetAvailableModelsCommand = { type: "get_available_models"; activeSessionId: string };
export type DaemonGetResourceSnapshotCommand = { type: "get_resource_snapshot"; activeSessionId: string };
/** Rust only (no TS v0.9.8 counterpart). */
export type DaemonGetMcpConnectionsCommand = { type: "get_mcp_connections"; activeSessionId: string };
/** Rust only: the inline paste flow; `server` must be a pasteable catalog service. */
export type DaemonSetMcpStaticTokenCommand = {
	type: "set_mcp_static_token";
	activeSessionId: string;
	server: string;
	token: string;
};
/** Rust only: drop one connection's credential and record together. */
export type DaemonRemoveMcpConnectionCommand = {
	type: "remove_mcp_connection";
	activeSessionId: string;
	server: string;
};

export type DaemonCommandBody =
	| DaemonCreateCommand
	| DaemonListCommand
	| DaemonListSavedSessionsCommand
	| DaemonForkCommand
	| DaemonKillCommand
	| DaemonDeleteSavedSessionCommand
	| DaemonAckResultCommand
	| DaemonGetModelCatalogCommand
	| DaemonGetAvailableModelsCommand
	| DaemonGetResourceSnapshotCommand
	| DaemonGetMcpConnectionsCommand
	| DaemonSetMcpStaticTokenCommand
	| DaemonRemoveMcpConnectionCommand
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
	// Rust only: the `/mcp` view read. Not in the TS list (v0.9.8 has no such command).
	"get_mcp_connections",
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

export function isDaemonHeartbeatsChangedFrame(frame: unknown): frame is DaemonHeartbeatsChangedFrame {
	return isRecord(frame) && frame.type === "heartbeats_changed";
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
	if (hello.schemaRevision !== DAEMON_SCHEMA_REVISION) return false;
	return daemonRuntimeFlavor(hello) === "rust" || daemonRuntimeFlavor(hello) === "typescript";
}

export function describeDaemonHello(hello: DaemonHelloFrame): string {
	const parts = [`${hello.protocol.name}@${hello.protocol.version}`];
	if (hello.schemaRevision !== undefined) parts.push(`schema ${hello.schemaRevision}`);
	if (hello.runtime?.buildId) parts.push(hello.runtime.buildId);
	return parts.join(", ");
}

// ---------------------------------------------------------------------------
// Model catalog, resource snapshot and MCP connection payloads (`response.data`).
// Field names mirror the Rust serde output exactly; `T | null` marks an
// `Option` the daemon serializes without `skip_serializing_if` (always present),
// `?:` marks one it omits when unset.
// ---------------------------------------------------------------------------

/** $/million tokens. PA@v0.10.1 `crates/pa-types/src/ai/mod.rs:656-664`. */
export type DaemonModelCost = { input: number; output: number; cacheRead: number; cacheWrite: number };

export type DaemonModelInput = "text" | "image";

/**
 * One model descriptor, `pa_types::ai::Model` (`crates/pa-types/src/ai/mod.rs:692-725`).
 * `thinkingLevelMap` maps a thinking level to the provider value (`null` = unsupported).
 */
export type DaemonModel = {
	id: string;
	name: string;
	api: string;
	provider: string;
	baseUrl: string;
	reasoning: boolean;
	thinkingLevelMap?: Record<string, string | null>;
	input: DaemonModelInput[];
	cost: DaemonModelCost;
	contextWindow: number;
	maxTokens: number;
	/** Present (and `true`) only when `maxTokens` came from models.json. */
	maxTokensExplicit?: boolean;
	featured?: boolean;
	headers?: Record<string, string>;
	compat?: Record<string, unknown>;
};

/**
 * `get_model_catalog`: every model (unauthorized private Prime Inference
 * models removed), sorted by (provider, id), plus the sorted, deduplicated
 * providers that have configured auth. Served from the current snapshot with no
 * network; a background refresh broadcasts `model_catalog_changed` when it
 * differs. PA@v0.10.1 `crates/pa-daemon/src/model_catalog.rs:22-55,103-136`.
 */
export type DaemonModelCatalog = { models: DaemonModel[]; configuredProviders: string[] };

/** `get_available_models`: auth-configured models only. `crates/pa-daemon/src/state_getters.rs:266-283`. */
export type DaemonAvailableModels = { models: DaemonModel[] };

/** `pa_core::skills::SourceInfo` (`crates/pa-core/src/skills/mod.rs:28-50`). */
export type DaemonResourceSourceInfo = {
	path: string;
	/** `auto` (discovered), `builtin`, or a package/CLI source label. */
	source: string;
	scope: "user" | "project" | "temporary";
	origin: "package" | "topLevel";
	baseDir: string | null;
};

/** `crates/pa-daemon/src/agent_engine/artifacts.rs:7-37`. */
export type DaemonResourceArtifact = {
	id: string;
	sessionId: string;
	type: "skill" | "prompt" | "context_file";
	logicalPath: string;
	/** Only when the file sits under the session cwd. */
	relativePath?: string;
};

export type DaemonResourceSkill = {
	name: string;
	filePath: string;
	sourceInfo: DaemonResourceSourceInfo;
	description?: string;
	artifact?: DaemonResourceArtifact;
};

export type DaemonResourcePrompt = {
	name: string;
	filePath: string;
	sourceInfo: DaemonResourceSourceInfo;
	description?: string;
	argumentHint?: string;
	artifact?: DaemonResourceArtifact;
};

export type DaemonResourceContextFile = { path: string; artifact?: DaemonResourceArtifact };

/** `pa_core::skills::ResourceDiagnostic` (`crates/pa-core/src/skills/diagnostics.rs:5-32`). */
export type DaemonResourceDiagnostic =
	| { type: "warning" | "error"; message: string; path?: string }
	| {
			type: "collision";
			message: string;
			path: string;
			collision: { resourceType: string; name: string; winnerPath: string; loserPath: string };
	  };

/**
 * `get_resource_snapshot`. The session's core engine builds lazily, so before
 * the first turn (or any command that builds it, e.g. `get_system_prompt`) the
 * snapshot is the all-empty shape. `themes` is always empty on Rust.
 * PA@v0.10.1 `crates/pa-daemon/src/agent_engine/session_engine_impl.rs:1105-1187`,
 * `crates/pa-daemon/src/engine/wire.rs:290-302`.
 */
export type DaemonResourceSnapshot = {
	contextFiles: DaemonResourceContextFile[];
	skills: DaemonResourceSkill[];
	prompts: DaemonResourcePrompt[];
	themes: unknown[];
	diagnostics: {
		skills: DaemonResourceDiagnostic[];
		prompts: DaemonResourceDiagnostic[];
		themes: DaemonResourceDiagnostic[];
	};
};

/** One `/mcp` roster row, `McpConnectionEntry` (`crates/pa-core/src/mcp/mod.rs:973-995`). */
export type DaemonMcpConnectionEntry = {
	server: string;
	label: string;
	connected: boolean;
	usesOauth: boolean;
	/** `subscription`, `api key`, or the transport for credential-less servers. */
	authKind: string;
	transport: string;
	userDeclared: boolean;
	generic: boolean;
};

/** `crates/pa-core/src/mcp/catalog_status_views.rs:12-21`. */
export type DaemonMcpConnectionStatus =
	| "connected"
	| "pending"
	| "not_connected"
	| "setup_required"
	| "disabled"
	| "error";

/** One service-catalog card, `McpPluginView` (`crates/pa-core/src/mcp/catalog_plugin_views.rs:25-59`). */
export type DaemonMcpServiceView = {
	serviceId: string;
	label: string;
	connectionStatus: DaemonMcpConnectionStatus;
	connectable: boolean;
	addAccountAllowed: boolean | null;
	loginPending: boolean | null;
	usesOauth: boolean;
	source: "catalog" | "user" | "acp";
	connectionIds: string[];
	/** View-only marker: this row opens the inline paste panel (`set_mcp_static_token`). */
	pasteToken: boolean | null;
	aliases: string[] | null;
	description: string | null;
	category: string | null;
	publisher: string | null;
	docsUrl: string | null;
	setupHint: string | null;
	unverified: boolean | null;
	/** Epoch ms from the connection record. */
	verifiedAt: number | null;
	toolCount: number | null;
};

/** A stored api-key slot the `/mcp` view manages (`catalog_plugin_views.rs:486-498`). */
export type DaemonMcpCredentialView = { id: string; label: string; configured: boolean };

/** `get_mcp_connections` (`crates/pa-daemon/src/mcp_connections.rs:28-87`). */
export type DaemonMcpConnections = {
	connections: DaemonMcpConnectionEntry[];
	services: DaemonMcpServiceView[];
	credentials: DaemonMcpCredentialView[];
	catalogDiagnostics: string[];
};

/**
 * `set_mcp_static_token`: the credential is stored (bound to `endpoint`) even
 * when verification fails; `verified:false` + `error` (a fixed category such
 * as `network-unreachable`, `unauthorized`, `credential-changed`) is still a
 * successful response. `crates/pa-daemon/src/mcp_connections.rs:89-147`,
 * `crates/pa-core/src/mcp/manager_catalog.rs:509-592`.
 */
export type DaemonSetMcpStaticTokenResult = {
	server: string;
	endpoint: string;
	verified: boolean;
	toolCount: number | null;
	error: string | null;
};

/** `remove_mcp_connection`: `removed` reports the credential removal. `mcp_connections.rs:149-184`. */
export type DaemonRemoveMcpConnectionResult = { server: string; removed: boolean };

function isString(value: unknown): value is string {
	return typeof value === "string";
}

function isNullable<T>(value: unknown, guard: (inner: unknown) => inner is T): value is T | null {
	return value === null || guard(value);
}

function isBoolean(value: unknown): value is boolean {
	return typeof value === "boolean";
}

function isNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isArrayOf<T>(value: unknown, guard: (item: unknown) => item is T): value is T[] {
	return Array.isArray(value) && value.every(guard);
}

function isStringArray(value: unknown): value is string[] {
	return isArrayOf(value, isString);
}

export function isDaemonModel(value: unknown): value is DaemonModel {
	return (
		isRecord(value) &&
		isString(value.id) &&
		isString(value.name) &&
		isString(value.api) &&
		isString(value.provider) &&
		isString(value.baseUrl) &&
		isBoolean(value.reasoning) &&
		isArrayOf(value.input, (input): input is DaemonModelInput => input === "text" || input === "image") &&
		isRecord(value.cost) &&
		isNumber(value.cost.input) &&
		isNumber(value.cost.output) &&
		isNumber(value.cost.cacheRead) &&
		isNumber(value.cost.cacheWrite) &&
		isNumber(value.contextWindow) &&
		isNumber(value.maxTokens) &&
		(value.thinkingLevelMap === undefined ||
			(isRecord(value.thinkingLevelMap) &&
				Object.values(value.thinkingLevelMap).every((level) => isNullable(level, isString)))) &&
		(value.maxTokensExplicit === undefined || isBoolean(value.maxTokensExplicit)) &&
		(value.featured === undefined || isBoolean(value.featured)) &&
		(value.headers === undefined || (isRecord(value.headers) && Object.values(value.headers).every(isString))) &&
		(value.compat === undefined || isRecord(value.compat))
	);
}

export function isDaemonModelCatalog(value: unknown): value is DaemonModelCatalog {
	return isRecord(value) && isArrayOf(value.models, isDaemonModel) && isStringArray(value.configuredProviders);
}

export function isDaemonAvailableModels(value: unknown): value is DaemonAvailableModels {
	return isRecord(value) && isArrayOf(value.models, isDaemonModel);
}

function isNamedResource(value: unknown): value is { name: string; filePath: string; sourceInfo: unknown } {
	return isRecord(value) && isString(value.name) && isString(value.filePath) && isRecord(value.sourceInfo);
}

function isResourceDiagnostic(value: unknown): value is DaemonResourceDiagnostic {
	return isRecord(value) && isString(value.type) && isString(value.message);
}

export function isDaemonResourceSnapshot(value: unknown): value is DaemonResourceSnapshot {
	if (!isRecord(value) || !isRecord(value.diagnostics)) return false;
	const diagnostics = value.diagnostics;
	return (
		isArrayOf(
			value.contextFiles,
			(file): file is DaemonResourceContextFile => isRecord(file) && isString(file.path),
		) &&
		isArrayOf(value.skills, isNamedResource) &&
		isArrayOf(value.prompts, isNamedResource) &&
		Array.isArray(value.themes) &&
		isArrayOf(diagnostics.skills, isResourceDiagnostic) &&
		isArrayOf(diagnostics.prompts, isResourceDiagnostic) &&
		isArrayOf(diagnostics.themes, isResourceDiagnostic)
	);
}

function isMcpConnectionEntry(value: unknown): value is DaemonMcpConnectionEntry {
	return (
		isRecord(value) &&
		isString(value.server) &&
		isString(value.label) &&
		isBoolean(value.connected) &&
		isBoolean(value.usesOauth) &&
		isString(value.authKind) &&
		isString(value.transport) &&
		isBoolean(value.userDeclared) &&
		isBoolean(value.generic)
	);
}

function isMcpServiceView(value: unknown): value is DaemonMcpServiceView {
	return (
		isRecord(value) &&
		isString(value.serviceId) &&
		isString(value.label) &&
		isString(value.connectionStatus) &&
		isBoolean(value.connectable) &&
		isBoolean(value.usesOauth) &&
		isString(value.source) &&
		isStringArray(value.connectionIds) &&
		isNullable(value.pasteToken, isBoolean) &&
		isNullable(value.toolCount, isNumber)
	);
}

function isMcpCredentialView(value: unknown): value is DaemonMcpCredentialView {
	return isRecord(value) && isString(value.id) && isString(value.label) && isBoolean(value.configured);
}

export function isDaemonMcpConnections(value: unknown): value is DaemonMcpConnections {
	return (
		isRecord(value) &&
		isArrayOf(value.connections, isMcpConnectionEntry) &&
		isArrayOf(value.services, isMcpServiceView) &&
		isArrayOf(value.credentials, isMcpCredentialView) &&
		isStringArray(value.catalogDiagnostics)
	);
}

export function isDaemonSetMcpStaticTokenResult(value: unknown): value is DaemonSetMcpStaticTokenResult {
	return (
		isRecord(value) &&
		isString(value.server) &&
		isString(value.endpoint) &&
		isBoolean(value.verified) &&
		isNullable(value.toolCount, isNumber) &&
		isNullable(value.error, isString)
	);
}

export function isDaemonRemoveMcpConnectionResult(value: unknown): value is DaemonRemoveMcpConnectionResult {
	return isRecord(value) && isString(value.server) && isBoolean(value.removed);
}
