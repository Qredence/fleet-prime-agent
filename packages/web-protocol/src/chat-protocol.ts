import type { ChatMessage, ChatToolPart } from "./chat-types";

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

export type ChatModelSelection =
	| string
	| {
			provider: string;
			id: string;
			thinkingLevel?: ChatThinkingLevel;
	  };

/**
 * Identifies the chat session a request targets. At least one of
 * `sessionFile`/`sessionId` is typically provided to continue an existing
 * session; omitting both starts a new one.
 */
export type ChatSessionMetadata = {
	sessionFile?: string;
	sessionId?: string;
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

type ChatStartEvent = {
	type: "start";
	id: string;
	runId: string;
	sessionFile?: string;
	sessionId: string;
	sessionReset?: boolean;
	diagnostics?: Array<string>;
};

/**
 * A single NDJSON frame emitted on the chat turn stream (`POST /api/chat`).
 *
 * Discriminated by `type`. A turn begins with `start`, then a mix of `delta` /
 * `tool` / `thinking` content, `plan` / `state` / `queue` lifecycle signals,
 * `compaction` / `retry` progress, and ends with `done` (success) or `error`.
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
	| { type: "thinking"; text: string; messageId?: string }
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
			errorMessage: string;
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
			sessionFile?: string;
			sessionId: string;
			sessionReset?: boolean;
	  }
	| { type: "error"; message: string; runId?: string };

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
	/** OCC family only: the named instance this row belongs to. */
	providerFamily?: string;
	/** OCC family only: user-supplied display label for the instance. */
	displayName?: string;
	/** Native Pi API family for a custom provider (absent for catalog rows). */
	api?: PiCustomProviderApi;
	/** Custom provider only: model ids registered for this provider. */
	modelIds?: Array<string>;
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

export type ChatSessionResponse = {
	session: ChatSessionMetadata;
	messages: Array<ChatMessage>;
	sessionReset?: boolean;
};

export type ChatSessionInfo = {
	path: string;
	id: string;
	cwd: string;
	name?: string;
	created: string;
	modified: string;
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

export type WorkspaceRootRequest = {
	path: string;
};

export type WorkspaceRootResponse = {
	root: string;
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
