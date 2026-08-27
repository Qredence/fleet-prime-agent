import type { ChatMessage, ChatToolCategory, ChatToolPart } from "./chat-types";
import type { ChatAttachment, ProjectId } from "./fleet-contract";

export type { ChatToolCategory };

export type FleetErrorCode =
	| "AUTH_CREDENTIAL_EXPIRED"
	| "AUTH_MISSING"
	| "KERNEL_CRASH"
	| "KERNEL_TIMEOUT"
	| "CONTEXT_OVERFLOW"
	| "BUDGET_EXCEEDED"
	| "TOOL_TIMEOUT"
	| "RATE_LIMIT"
	| "NETWORK_DISCONNECTED"
	| "EXTENSION_ERROR"
	| "SESSION_ABORTED"
	| "UNKNOWN_ERROR";

export type FleetErrorRemediationAction =
	| "open_settings_tab"
	| "restart_kernel"
	| "retry_turn"
	| "compact_context"
	| "expand_budget"
	| "reconnect";

export type FleetErrorRemediation = {
	action: FleetErrorRemediationAction;
	target?: string;
	label: string;
};

export type FleetErrorEnvelope = {
	code: FleetErrorCode;
	message: string;
	provider?: string;
	isTerminal?: boolean;
	remediation?: FleetErrorRemediation;
};

export type ChatErrorStreamEvent = {
	type: "error";
	message: string;
	runId?: string;
	code?: FleetErrorCode;
	error?: FleetErrorEnvelope;
};

export type QueueState = {
	steering: Array<string>;
	followUp: Array<string>;
};

export type ChatMode = "agent" | "plan" | "harness";

export type ChatPlanAction = "execute" | "refine";

export type ChatThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type ChatTransport = "auto" | "sse" | "websocket";

export type ChatDeliveryMode = "all" | "one-at-a-time";

export type ChatPackageSource = string | Record<string, unknown>;

export type ChatPiSettings = {
	compaction: {
		enabled: boolean;
		reserveTokens: number;
		keepRecentTokens: number;
	};
	defaultModel?: string;
	defaultProvider?: string;
	defaultThinkingLevel?: ChatThinkingLevel;
	enableSkillCommands: boolean;
	enabledModels?: Array<string>;
	extensions: Array<string>;
	followUpMode: ChatDeliveryMode;
	packages: Array<ChatPackageSource>;
	prompts: Array<string>;
	retry: {
		enabled: boolean;
		maxRetries: number;
		baseDelayMs: number;
	};
	skills: Array<string>;
	steeringMode: ChatDeliveryMode;
	themes: Array<string>;
	transport: ChatTransport;
};

export type ChatPiSettingsUpdate = Partial<{
	compaction: Partial<ChatPiSettings["compaction"]>;
	defaultModel: string;
	defaultProvider: string;
	defaultThinkingLevel: ChatThinkingLevel;
	enableSkillCommands: boolean;
	enabledModels: Array<string> | null;
	extensions: Array<string>;
	followUpMode: ChatDeliveryMode;
	packages: Array<ChatPackageSource>;
	prompts: Array<string>;
	retry: Partial<ChatPiSettings["retry"]>;
	skills: Array<string>;
	steeringMode: ChatDeliveryMode;
	themes: Array<string>;
	transport: ChatTransport;
}>;

export type ChatSettingsUpdateRequest = {
	settings: ChatPiSettingsUpdate;
};

export type ChatSettingsResponse = {
	diagnostics: Array<string>;
	effective: ChatPiSettings;
	project: ChatPiSettingsUpdate;
	projectPath: string;
	updateImpact: {
		newSessionRecommended: boolean;
		resourceReloadRequired: boolean;
	};
};

export type ChatModelSelection = {
	provider: string;
	id: string;
	thinkingLevel?: ChatThinkingLevel;
};

export type ChatSessionMetadata = {
	sessionId?: string;
	projectId?: ProjectId | null;
};

export type ChatServiceTier = "auto" | "default" | "flex" | "scale" | "priority" | null;

export type PrimeAgentArtifactKind = "bash" | "ipython" | "mcp" | "generic" | "diff" | "rlm" | "recap" | "refinement";

export type PrimeAgentArtifactStatus = "running" | "success" | "error" | "cancelled";

export type PrimeAgentArtifact = {
	id: string;
	runId: string;
	sourceMessageId?: string;
	sourceToolCallId?: string;
	kind: PrimeAgentArtifactKind;
	title: string;
	status: PrimeAgentArtifactStatus;
	input?: unknown;
	output?: unknown;
	timestamp: number;
};

export type PrimeAgentArtifactRun = {
	id: string;
	runId: string;
	artifacts: Array<PrimeAgentArtifact>;
	startedAt?: number;
	endedAt?: number;
};

export type PrimeAgentUserBash = {
	id: string;
	runId: string;
	command: string;
	output: string;
	status: PrimeAgentArtifactStatus;
	exitCode?: number;
	cancelled: boolean;
	truncated: boolean;
	excludeFromContext: boolean;
	errorMessage?: string;
	startedAt: number;
	endedAt?: number;
};

export type PrimeAgentRlmChild = {
	id: string;
	parentId?: string;
	activeSessionId?: string;
	sessionName?: string;
	model?: string;
	label: string;
	status: "queued" | "running" | "done" | "error" | "cancelled";
	durationMs?: number;
	answerPreview?: string;
	toolUseCount?: number;
	tokenCount?: number;
	recap?: string;
	activity?: { kind: "waiting" | "writing" | "executing"; toolName?: string };
	repliedSinceTask?: boolean;
	error?: string;
	timestamp: number;
};

export type PrimeAgentGoal = {
	active: boolean;
	status: "idle" | "active" | "paused" | "budget_limited" | "complete" | "error";
	goalId?: string;
	objective?: string;
	tokenBudget?: number;
	tokensUsed: number;
	timeUsedSeconds: number;
	continuationsUsed: number;
	createdAt?: number;
	updatedAt?: number;
	lastReason?: string;
	lastError?: string;
};

export type PrimeAgentRefinementEdit = {
	action: "create" | "update" | "delete";
	kind: string;
	id: string;
	title?: string;
	content?: string;
	reason?: string;
	before?: string;
	after?: string;
	applied: boolean;
	error?: string;
};

export type PrimeAgentRefinement = {
	id: string;
	summary: string;
	rationale: string;
	expectedOutcome: string;
	scope?: "local" | "global";
	rollbackOf?: string;
	edits: Array<PrimeAgentRefinementEdit>;
	status: "success" | "error";
	error?: string;
	timestamp: number;
};

export type PrimeAgentSessionPresentation = {
	revision: number;
	sessionName?: string;
	thinkingLevel?: ChatThinkingLevel;
	serviceTier?: ChatServiceTier;
	goal?: PrimeAgentGoal;
	recap?: string;
	userBash: Array<PrimeAgentUserBash>;
	rlmChildren: Array<PrimeAgentRlmChild>;
	refinements: Array<PrimeAgentRefinement>;
	artifactRuns: Array<PrimeAgentArtifactRun>;
};

/**
 * Body of a `POST /api/chat` turn request.
 *
 * `userId`/`userEmail` may appear on the wire for OpenAPI documentation but
 * client-supplied values are stripped after validation; the server sets them
 * only from the authenticated session (see the `post-chat` handler).
 * Validated by `ChatRequestSchema` in `chat-protocol.zod`.
 */
export type ChatRequest = ChatSessionMetadata & {
	message?: string;
	model?: ChatModelSelection;
	mode?: ChatMode;
	openUI?: boolean;
	attachments?: Array<ChatAttachment>;
	planAction?: ChatPlanAction;
	streamingBehavior?: "steer" | "followUp";
	userId?: string;
	userEmail?: string;
};

export type ChatQuestionAnswer = {
	kind: "single" | "multi" | "text" | "skip";
	questionId?: string;
	selectedIds?: Array<string>;
	text?: string;
};

export type ChatQuestionAnswerRequest = ChatSessionMetadata & {
	toolCallId?: string;
	answer: ChatQuestionAnswer;
};

export type ChatQuestionAnswerResponse = {
	ok: boolean;
	message?: string;
	mode?: ChatMode;
	planAction?: ChatPlanAction;
};

export type ChatPlanTodo = {
	step: number;
	text: string;
	completed: boolean;
};

export type ChatPlanState = {
	mode: ChatMode;
	executing: boolean;
	pendingDecision: boolean;
	completed: number;
	total: number;
	todos: Array<ChatPlanTodo>;
	message?: string;
};

/** Durable Fleet-owned presentation record for an explicitly Plan-mode response. */
export type ChatPlanPresentation = {
	assistantMessageId: string;
	/** Original client-side (run-scoped) message id, kept so in-flight upserts resolve to this record. */
	clientMessageId?: string;
	state: ChatPlanState;
};
export type ChatPlanPresentationUpsertRequest = {
	sessionId: string;
	presentation: ChatPlanPresentation;
};
/** Optional, capability-gated browser enhancements owned by Fleet Prime. */
export type FleetAdapterFeature = "reasoning-summary-v1";

export type FleetAdapterCapabilities = {
	// Forward-tolerant wire shape: a newer adapter may advance either revision
	// or append unknown features; consumers only gate on values they know.
	protocolVersion: number;
	schemaRevision: number;
	features: Array<FleetAdapterFeature | string>;
};

/**
 * Browser-safe progress presentation for an agent turn. `steps` are controlled
 * Fleet labels; they must never contain raw detailed model reasoning.
 */
export type ChatReasoningStep = {
	id: string;
	title: string;
	body: string;
};

export type ChatReasoningPresentation = {
	runId: string;
	phase: "waiting" | "context" | "planning" | "executing" | "responding" | "recovering" | "complete" | "error";
	steps: Array<ChatReasoningStep>;
	visibleSteps: number;
	streaming: boolean;
	startedAt: number;
	elapsedMs?: number;
	restingLabel: string;
};

export type ChatThinkingPhase = "start" | "delta" | "end";

/**
 * Legacy live provider thinking frame accepted for older adapters. Current
 * adapters never emit it, and browser reducers must ignore it.
 */
export type ChatThinkingEvent = {
	type: "thinking";
	phase?: ChatThinkingPhase;
	text: string;
	messageId?: string;
};

/** Request-specific completion metadata for non-turn chat requests. */
export type ChatStreamRequestKind = "session-command";

export type ChatPresentationEvent = {
	type: "presentation";
	sessionId: string;
	presentation: PrimeAgentSessionPresentation;
};

export type ChatMessageEvent = {
	type: "message";
	message: ChatMessage;
};

export const FLEET_ADAPTER_CAPABILITIES: FleetAdapterCapabilities = {
	protocolVersion: 1,
	schemaRevision: 1,
	features: ["reasoning-summary-v1"],
};

type ChatStartEvent = {
	type: "start";
	id: string;
	runId: string;
	sessionId: string;
	requestKind?: ChatStreamRequestKind;
	sessionReset?: boolean;
	diagnostics?: Array<string>;
	adapterCapabilities?: FleetAdapterCapabilities;
};

/** First frame of the SSE replay channel; carries optional adapter capabilities. */
export type ChatConnectedFrame = {
	type: "connected";
	sessionId: string;
	adapterCapabilities?: FleetAdapterCapabilities;
};

/**
 * A single NDJSON frame emitted on the chat turn stream (`POST /api/chat`).
 *
 * Discriminated by `type`. A turn begins with `start`, then a mix of `delta` /
 * `tool` content, `plan` / `state` / `queue` lifecycle signals,
 * `compaction` / `retry` progress, and ends with `done` (success) or `error`.
 * Legacy `thinking` frames may still be received from older adapters but are
 * ignored by the browser.
 * Validated by `ChatStreamEventSchema` in `chat-protocol.zod`.
 */
export type ChatStreamEvent =
	| ChatStartEvent
	| { type: "delta"; text: string; messageId?: string }
	| { type: "tool"; part: ChatToolPart; messageId?: string }
	| {
			type: "plan";
			mode: ChatMode;
			executing: boolean;
			completed: number;
			total: number;
			message?: string;
			state: ChatPlanState;
	  }
	| { type: "state"; state: ChatStateEvent }
	| { type: "queue"; steering: Array<string>; followUp: Array<string> }
	| ChatThinkingEvent
	| ChatPresentationEvent
	| ChatMessageEvent
	| { type: "reasoning"; presentation: ChatReasoningPresentation; messageId?: string }
	| { type: "compaction"; phase: "start"; reason: string }
	| {
			type: "compaction";
			phase: "end";
			reason: string;
			aborted: boolean;
			willRetry: boolean;
			errorMessage?: string;
	  }
	| {
			type: "retry";
			phase: "start";
			attempt: number;
			maxAttempts: number;
			delayMs: number;
			errorMessage?: string;
	  }
	| {
			type: "retry";
			phase: "end";
			success: boolean;
			attempt: number;
			finalError?: string;
	  }
	| {
			type: "done";
			runId: string;
			message: ChatMessage;
			sessionId: string;
			requestKind?: ChatStreamRequestKind;
			sessionReset?: boolean;
	  }
	| ChatErrorStreamEvent;

type ChatStateEvent = {
	name: "agent_start" | "agent_end" | "agent_settled" | "turn_start" | "turn_end" | "message_start" | "message_end";
	message?: string;
};

export type ChatModelInfo = {
	key: string;
	provider: string;
	id: string;
	name: string;
	version?: string;
	reasoning: boolean;
	input: Array<"text" | "image">;
	contextWindow?: number;
	maxTokens?: number;
	available: boolean;
	defaultThinkingLevel?: ChatThinkingLevel;
	thinkingLevels?: Array<ChatThinkingLevel>;
};

export type ChatModelsResponse = {
	models: Array<ChatModelInfo>;
	selectedModelKey?: string;
	defaultProvider?: string;
	defaultModel?: string;
	defaultThinkingLevel?: ChatThinkingLevel;
	diagnostics: Array<string>;
};

export type ChatModelsDiscoverRequest = {
	providerId: string;
};

export type ChatModelsDiscoverResponse = {
	providerId: string;
	models: Array<ChatModelInfo>;
};

/** Pi API families supported by native custom providers. */
export type PiCustomProviderApi = "openai-completions" | "openai-responses" | "anthropic-messages" | "google-genai";

export type ChatProviderInfo = {
	id: string;
	name: string;
	isConfigured: boolean;
	envVarName: string;
	authType?: "apiKey" | "oauth";
	/** Whether this provider also exposes an interactive OAuth login. */
	supportsOAuth?: boolean;
	/** OCC family only: the named instance this row belongs to. */
	providerFamily?: string;
	/** OCC family only: user-supplied display label for the instance. */
	displayName?: string;
	/** Custom provider only: native Pi API family for a custom provider (absent for catalog rows). */
	api?: PiCustomProviderApi;
	/** Custom provider/OCC only: non-secret base URL used by the Settings editor. */
	baseUrl?: string;
	/** Custom provider only: model ids registered for this provider. */
	modelIds?: Array<string>;
	/** Custom provider/OCC only: models can be discovered from the recorded base URL. */
	discoverable?: boolean;
};

export type ChatProviderUpdateRequest = {
	providerId: string;
	apiKey: string;
	/** OpenAI Chat Completions companion: base URL */
	baseUrl?: string;
	/** OpenAI Chat Completions companion: model id */
	modelId?: string;
	/** OCC family only: display label for a named instance */
	displayName?: string;
	/**
	 * Explicitly create a new provider instance: an OCC named instance
	 * (`openai-chat-completions+<slug>`) or a general custom provider
	 * (`custom+<slug>`). The OCC-specific field name is legacy, kept for wire
	 * compatibility.
	 */
	createOccInstance?: boolean;
	/** Custom provider only: native Pi API family. */
	api?: PiCustomProviderApi;
	/** Custom provider only: model ids to register. */
	models?: Array<string>;
};

export type ChatProviderUpdateResponse = {
	success: boolean;
	providers: Array<ChatProviderInfo>;
	reloadRequired?: boolean;
};

export type ChatProviderRemoveRequest = {
	providerId: string;
};

export type ChatProviderRemoveResponse = ChatProviderUpdateResponse;

export type ChatProviderOAuthLoginStatus = "waiting" | "success" | "error";

export type ChatProviderOAuthPrompt = {
	message: string;
	placeholder?: string;
	allowEmpty?: boolean;
};

/**
 * Start, poll, continue, or cancel an interactive OAuth login.
 * Device-code providers (GitHub Copilot) return `authUrl` + `userCode` and poll
 * until the user completes the flow. Callback providers (Anthropic, Codex)
 * return `authUrl` and optionally accept a pasted redirect via `promptAnswer`.
 */
export type ChatProviderOAuthLoginRequest = {
	providerId: string;
	loginId?: string;
	promptAnswer?: string;
	cancel?: boolean;
};

export type ChatProviderOAuthLoginResponse = {
	status: ChatProviderOAuthLoginStatus;
	loginId?: string;
	authUrl?: string;
	userCode?: string;
	instructions?: string;
	prompt?: ChatProviderOAuthPrompt;
	error?: string;
	providers?: Array<ChatProviderInfo>;
};

export type ChatSessionResponse = {
	session: ChatSessionMetadata;
	messages: Array<ChatMessage>;
	planPresentations: Array<ChatPlanPresentation>;
	presentation: PrimeAgentSessionPresentation;
	sessionReset?: boolean;
};

export type ChatNewRequest = {
	projectId?: ProjectId;
	thinkingLevel?: ChatThinkingLevel;
	mode?: ChatMode;
	model?: ChatModelSelection;
};

export type ChatSessionInfo = {
	sessionId: string;
	projectId?: ProjectId | null;
	title: string;
	createdAt: string;
	updatedAt: string;
	status: "idle" | "running" | "interrupted" | "failed";
	messageCount: number;
	firstMessage: string;
};

export type ChatResourceInfo = {
	activationStatus?: "active" | "staged" | "reload-required";
	name: string;
	description?: string;
	installedInWorkspace?: boolean;
	path?: string;
	source?: string;
	workspacePath?: string;
	argumentHint?: string;
};

export type ChatResourcesResponse = {
	packages: Array<ChatResourceInfo>;
	skills: Array<ChatResourceInfo>;
	prompts: Array<ChatResourceInfo>;
	extensions: Array<ChatResourceInfo>;
	themes: Array<ChatResourceInfo>;
	agentsFiles: Array<ChatResourceInfo>;
	diagnostics: Array<string>;
};

export type WorkspaceTreeNode = {
	name: string;
	path: string;
	type: "directory" | "file";
	children?: Array<WorkspaceTreeNode>;
};

export type WorkspaceTreeResponse = {
	root: string;
	nodes: Array<WorkspaceTreeNode>;
	diagnostics: Array<string>;
};

export type WorkspaceFileResponse = {
	path: string;
	name: string;
	content: string;
	mediaType: "text/markdown" | "text/plain" | "application/octet-stream";
	size?: number;
	status?: "ok" | "too-large" | "unsupported";
};

export type WorkspaceBrowseEntry = {
	name: string;
	path: string;
};

export type WorkspaceBrowseResponse = {
	path: string;
	parent: string | null;
	entries: Array<WorkspaceBrowseEntry>;
};

export type ChatSlashCommandSource = "builtin" | "extension" | "prompt" | "skill";

export type ChatSlashCommandInfo = {
	name: string;
	description?: string;
	argumentHint?: string;
	source: ChatSlashCommandSource;
	passThrough?: boolean;
};

export type ChatCommandsResponse = {
	commands: Array<ChatSlashCommandInfo>;
	diagnostics: Array<string>;
};
