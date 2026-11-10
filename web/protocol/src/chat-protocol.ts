import type { z } from "zod/v4";
import type { ChatToolCategory } from "./chat-types";
import type { OpenUIHtmlArtifactPayload } from "./openui-artifact";
import type {
	ChatCommandsResponseSchema,
	ChatModelInfoSchema,
	ChatModelsDiscoverRequestSchema,
	ChatModelsDiscoverResponseSchema,
	ChatModelsResponseSchema,
	ChatProviderInfoSchema,
	ChatProviderOAuthLoginRequestSchema,
	ChatProviderOAuthLoginResponseSchema,
	ChatProviderOAuthLoginStatusSchema,
	ChatProviderOAuthPromptSchema,
	ChatProviderRemoveRequestSchema,
	ChatProviderRemoveResponseSchema,
	ChatProviderUpdateRequestSchema,
	ChatProviderUpdateResponseSchema,
	ChatResourceInfoSchema,
	ChatResourcesResponseSchema,
	ChatSlashCommandInfoSchema,
	ChatSlashCommandSourceSchema,
	PiCustomProviderApiSchema,
	WorkspaceBrowseEntrySchema,
	WorkspaceBrowseResponseSchema,
	WorkspaceFileResponseSchema,
	WorkspaceTreeNode,
	WorkspaceTreeResponseSchema,
} from "./schemas/catalog";
import type {
	ChatClarificationQuestionSchema,
	ChatErrorEventSchema,
	ChatMessageEventSchema,
	ChatModelSelectionSchema,
	ChatNewRequestSchema,
	ChatOpenUIArtifactUpsertRequestSchema,
	ChatOpenUIArtifactUpsertResponseSchema,
	ChatPayloadEventSchema,
	ChatPendingDialogSchema,
	ChatPendingDialogsResponseSchema,
	ChatPlanPresentationSchema,
	ChatPlanPresentationUpsertRequestSchema,
	ChatPlanStateSchema,
	ChatPlanTodoSchema,
	ChatPresentationEventSchema,
	ChatQuestionAnswerRequestSchema,
	ChatQuestionAnswerResponseSchema,
	ChatQuestionAnswerSchema,
	ChatQueueMutationKindSchema,
	ChatQueueMutationRequestSchema,
	ChatQueueMutationResponseSchema,
	ChatQueueReplaceMutationSchema,
	ChatReasoningPresentationSchema,
	ChatReasoningStepSchema,
	ChatReasoningTextEventSchema,
	ChatRequestSchema,
	ChatRlmStreamEventSchema,
	ChatSessionInfoSchema,
	ChatSessionMetadataSchema,
	ChatSessionResponseSchema,
	ChatSessionSnapshotEventSchema,
	ChatStreamEventCursorSchema,
	ChatStreamEventSchema,
	ChatThinkingEventSchema,
	FleetAdapterCapabilitiesSchema,
	FleetAdapterFeatureSchema,
	FleetErrorCodeSchema,
	FleetErrorEnvelopeSchema,
	FleetErrorRemediationActionSchema,
	FleetErrorRemediationSchema,
	PrimeAgentArtifactKindSchema,
	PrimeAgentArtifactRunSchema,
	PrimeAgentArtifactSchema,
	PrimeAgentArtifactStatusSchema,
	PrimeAgentGoalSchema,
	PrimeAgentKernelDiagnosticsSchema,
	PrimeAgentParentSessionSchema,
	PrimeAgentRefinementEditSchema,
	PrimeAgentRefinementSchema,
	PrimeAgentRlmChildSchema,
	PrimeAgentRlmNodeSchema,
	PrimeAgentRlmTreeSchema,
	PrimeAgentSessionPresentationSchema,
	PrimeAgentUserBashSchema,
} from "./schemas/chat";
import type {
	ChatPackageSourceSettingsSchema,
	ChatPiSettingsSchema,
	ChatPiSettingsUpdateSchema,
	ChatSettingsResponseSchema,
} from "./schemas/settings";
import type {
	ChatDeliveryModeSchema,
	ChatModeSchema,
	ChatPlanActionSchema,
	ChatThinkingLevelSchema,
	ChatTransportSchema,
} from "./schemas/shared";

export type { ChatToolCategory, OpenUIHtmlArtifactPayload, WorkspaceTreeNode };

export type FleetErrorCode = z.infer<typeof FleetErrorCodeSchema>;
export type FleetErrorRemediationAction = z.infer<typeof FleetErrorRemediationActionSchema>;
export type FleetErrorRemediation = z.infer<typeof FleetErrorRemediationSchema>;
export type FleetErrorEnvelope = z.infer<typeof FleetErrorEnvelopeSchema>;
export type ChatErrorEnvelope = FleetErrorEnvelope;
export type ChatErrorStreamEvent = z.infer<typeof ChatErrorEventSchema>;

/** Canonical user-facing message for NETWORK_DISCONNECTED error envelopes. */
export const NETWORK_DISCONNECTED_MESSAGE =
	"Fleet Prime is not connected to the Prime Agent runtime. Start or reconnect the runtime, then try again.";

export type QueueState = z.infer<typeof ChatQueueMutationResponseSchema>["queue"];
export type ChatQueueReplaceMutation = z.infer<typeof ChatQueueReplaceMutationSchema>;
export type ChatQueueMutationKind = z.infer<typeof ChatQueueMutationKindSchema>;
export type ChatQueueMutationRequest = z.infer<typeof ChatQueueMutationRequestSchema>;
export type ChatQueueMutationResponse = z.infer<typeof ChatQueueMutationResponseSchema>;

export type ChatMode = z.infer<typeof ChatModeSchema>;
export type ChatPlanAction = z.infer<typeof ChatPlanActionSchema>;
export type ChatThinkingLevel = z.infer<typeof ChatThinkingLevelSchema>;
export type ChatTransport = z.infer<typeof ChatTransportSchema>;
export type ChatDeliveryMode = z.infer<typeof ChatDeliveryModeSchema>;
export type ChatPackageSource = z.infer<typeof ChatPackageSourceSettingsSchema> | Record<string, unknown>;
export type ChatPiSettings = Omit<z.infer<typeof ChatPiSettingsSchema>, "packages"> & {
	packages: Array<ChatPackageSource>;
};
export type ChatPiSettingsUpdate = Omit<z.infer<typeof ChatPiSettingsUpdateSchema>, "packages"> & {
	packages?: Array<ChatPackageSource>;
};
export type ChatSettingsUpdateRequest = {
	settings: ChatPiSettingsUpdate;
};
export type ChatSettingsResponse = Omit<z.infer<typeof ChatSettingsResponseSchema>, "effective" | "project"> & {
	effective: ChatPiSettings;
	project: ChatPiSettingsUpdate;
};

export type ChatModelSelection = z.infer<typeof ChatModelSelectionSchema>;
export type ChatSessionMetadata = z.infer<typeof ChatSessionMetadataSchema>;
export type ChatServiceTier = "auto" | "default" | "flex" | "scale" | "priority" | null;

export type PrimeAgentArtifactKind = z.infer<typeof PrimeAgentArtifactKindSchema>;
export type PrimeAgentArtifactStatus = z.infer<typeof PrimeAgentArtifactStatusSchema>;
export type PrimeAgentArtifact = z.infer<typeof PrimeAgentArtifactSchema>;
export type PrimeAgentArtifactRun = z.infer<typeof PrimeAgentArtifactRunSchema>;
export type PrimeAgentUserBash = z.infer<typeof PrimeAgentUserBashSchema>;
export type PrimeAgentRlmChild = z.infer<typeof PrimeAgentRlmChildSchema>;
export type PrimeAgentRlmNode = z.infer<typeof PrimeAgentRlmNodeSchema>;
export type PrimeAgentRlmTree = z.infer<typeof PrimeAgentRlmTreeSchema>;
export type PrimeAgentParentSession = z.infer<typeof PrimeAgentParentSessionSchema>;
export type PrimeAgentGoal = z.infer<typeof PrimeAgentGoalSchema>;
export type PrimeAgentRefinementEdit = z.infer<typeof PrimeAgentRefinementEditSchema>;
export type PrimeAgentRefinement = z.infer<typeof PrimeAgentRefinementSchema>;
export type PrimeAgentKernelDiagnostics = z.infer<typeof PrimeAgentKernelDiagnosticsSchema>;
export type PrimeAgentSessionPresentation = z.infer<typeof PrimeAgentSessionPresentationSchema>;

export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type ChatClarificationQuestion = z.infer<typeof ChatClarificationQuestionSchema>;
export type ChatQuestionAnswer = z.infer<typeof ChatQuestionAnswerSchema>;
export type ChatPendingDialog = z.infer<typeof ChatPendingDialogSchema>;
export type ChatPendingDialogsResponse = z.infer<typeof ChatPendingDialogsResponseSchema>;
export type ChatQuestionAnswerRequest = z.infer<typeof ChatQuestionAnswerRequestSchema>;
export type ChatQuestionAnswerResponse = z.infer<typeof ChatQuestionAnswerResponseSchema>;

export type ChatPlanTodo = z.infer<typeof ChatPlanTodoSchema>;
export type ChatPlanState = z.infer<typeof ChatPlanStateSchema>;
export type ChatPlanPresentation = z.infer<typeof ChatPlanPresentationSchema>;
export type ChatPlanPresentationUpsertRequest = z.infer<typeof ChatPlanPresentationUpsertRequestSchema>;

export type ChatOpenUIArtifactUpsertRequest = z.infer<typeof ChatOpenUIArtifactUpsertRequestSchema>;
export type ChatOpenUIArtifactUpsertResponse = z.infer<typeof ChatOpenUIArtifactUpsertResponseSchema>;

export type FleetAdapterFeature = z.infer<typeof FleetAdapterFeatureSchema>;
export type FleetAdapterCapabilities = z.infer<typeof FleetAdapterCapabilitiesSchema>;

export type ChatReasoningStep = z.infer<typeof ChatReasoningStepSchema>;
export type ChatReasoningPresentation = z.infer<typeof ChatReasoningPresentationSchema>;
export type ChatThinkingPhase = "start" | "delta" | "end";
export type ChatThinkingEvent = z.infer<typeof ChatThinkingEventSchema>;
export type ChatReasoningTextEvent = z.infer<typeof ChatReasoningTextEventSchema>;
export type ChatStreamRequestKind = "session-command";
export type ChatPresentationEvent = z.infer<typeof ChatPresentationEventSchema>;
export type ChatMessageEvent = z.infer<typeof ChatMessageEventSchema>;
export type ChatPayloadEvent = z.infer<typeof ChatPayloadEventSchema>;
export type ChatRlmStreamEvent = z.infer<typeof ChatRlmStreamEventSchema>;
export type ChatSessionSnapshotEvent = z.infer<typeof ChatSessionSnapshotEventSchema>;

export const FLEET_ADAPTER_CAPABILITIES: FleetAdapterCapabilities = {
	protocolVersion: 1,
	schemaRevision: 4,
	features: [
		"reasoning-summary-v1",
		"mcp-connections-v1",
		"session-tree-v1",
		"composer-intent-v1",
		"composer-completion-v1",
	],
};

/** First frame of the SSE replay channel; carries optional adapter capabilities. */
export type ChatConnectedFrame = {
	type: "connected";
	sessionId: string;
	adapterCapabilities?: FleetAdapterCapabilities;
	streamGeneration?: string;
	cursorReset?: boolean;
	resumeAccepted?: boolean;
};

export type ChatStreamEventCursor = z.infer<typeof ChatStreamEventCursorSchema>;
export type ChatStreamEvent = z.infer<typeof ChatStreamEventSchema>;

export type ChatModelInfo = z.infer<typeof ChatModelInfoSchema>;
export type ChatModelsResponse = z.infer<typeof ChatModelsResponseSchema>;
export type ChatModelsDiscoverRequest = z.infer<typeof ChatModelsDiscoverRequestSchema>;
export type ChatModelsDiscoverResponse = z.infer<typeof ChatModelsDiscoverResponseSchema>;

export type PiCustomProviderApi = z.infer<typeof PiCustomProviderApiSchema>;
export type ChatProviderInfo = z.infer<typeof ChatProviderInfoSchema>;
export type ChatProviderUpdateRequest = z.infer<typeof ChatProviderUpdateRequestSchema>;
export type ChatProviderUpdateResponse = z.infer<typeof ChatProviderUpdateResponseSchema>;
export type ChatProviderRemoveRequest = z.infer<typeof ChatProviderRemoveRequestSchema>;
export type ChatProviderRemoveResponse = z.infer<typeof ChatProviderRemoveResponseSchema>;
export type ChatProviderOAuthLoginStatus = z.infer<typeof ChatProviderOAuthLoginStatusSchema>;
export type ChatProviderOAuthPrompt = z.infer<typeof ChatProviderOAuthPromptSchema>;
export type ChatProviderOAuthLoginRequest = z.infer<typeof ChatProviderOAuthLoginRequestSchema>;
export type ChatProviderOAuthLoginResponse = z.infer<typeof ChatProviderOAuthLoginResponseSchema>;

export type ChatSessionResponse = z.infer<typeof ChatSessionResponseSchema>;
export type ChatNewRequest = z.infer<typeof ChatNewRequestSchema>;
export type ChatSessionInfo = z.infer<typeof ChatSessionInfoSchema>;

export type ChatResourceInfo = z.infer<typeof ChatResourceInfoSchema>;
export type ChatResourcesResponse = z.infer<typeof ChatResourcesResponseSchema>;
export type WorkspaceTreeResponse = z.infer<typeof WorkspaceTreeResponseSchema>;
export type WorkspaceFileResponse = z.infer<typeof WorkspaceFileResponseSchema>;
export type WorkspaceBrowseEntry = z.infer<typeof WorkspaceBrowseEntrySchema>;
export type WorkspaceBrowseResponse = z.infer<typeof WorkspaceBrowseResponseSchema>;
export type ChatSlashCommandSource = z.infer<typeof ChatSlashCommandSourceSchema>;
export type ChatSlashCommandInfo = z.infer<typeof ChatSlashCommandInfoSchema>;
export type ChatCommandsResponse = z.infer<typeof ChatCommandsResponseSchema>;

export type {
	ChatMcpDeleteRequest,
	ChatMcpListResponse,
	ChatMcpOAuthAction,
	ChatMcpOAuthLoginRequest,
	ChatMcpOAuthLoginResponse,
	ChatMcpUpsertRequest,
	McpConnectionInfo,
	McpConnectionSource,
	McpConnectionStatus,
	McpConnectionTransport,
	McpEnvBinding,
} from "./mcp";
export type {
	SessionTreeNavigateRequest,
	SessionTreeNavigateResponse,
	SessionTreeNode,
	SessionTreeNodeKind,
	SessionTreeNodeRole,
	SessionTreeSnapshot,
	SessionTreeSnapshotResponse,
} from "./schemas/session-tree";
