import type {
	ProjectDirectoryBrowseResponse,
	ProjectForkResponse,
	ProjectId,
	ProjectListResponse,
	ProjectSummary,
} from "@prime-agent/web-protocol";
import type {
	ChatCommandsResponse,
	ChatModelsDiscoverRequest,
	ChatModelsDiscoverResponse,
	ChatModelsResponse,
	ChatPlanPresentation,
	ChatPlanPresentationUpsertRequest,
	ChatProviderInfo,
	ChatProviderOAuthLoginRequest,
	ChatProviderOAuthLoginResponse,
	ChatProviderRemoveRequest,
	ChatProviderRemoveResponse,
	ChatProviderUpdateRequest,
	ChatProviderUpdateResponse,
	ChatQuestionAnswerRequest,
	ChatQuestionAnswerResponse,
	ChatRequest,
	ChatResourcesResponse,
	ChatSessionInfo,
	ChatSessionMetadata,
	ChatSessionResponse,
	ChatSettingsResponse,
	ChatSettingsUpdateRequest,
	ChatStreamEvent,
	WorkspaceBrowseResponse,
	WorkspaceFileResponse,
	WorkspaceTreeResponse,
} from "@prime-agent/web-protocol/chat-protocol";
import {
	ChatCommandsResponseSchema,
	ChatModelsDiscoverRequestSchema,
	ChatModelsDiscoverResponseSchema,
	ChatModelsResponseSchema,
	ChatPlanPresentationSchema,
	ChatPlanPresentationUpsertRequestSchema,
	ChatProviderOAuthLoginRequestSchema,
	ChatProviderOAuthLoginResponseSchema,
	ChatProviderRemoveRequestSchema,
	ChatProvidersResponseSchema,
	ChatProviderUpdateRequestSchema,
	ChatProviderUpdateResponseSchema,
	ChatQuestionAnswerResponseSchema,
	ChatResourcesResponseSchema,
	ChatSessionResponseSchema,
	ChatSessionsResponseSchema,
	ChatSettingsResponseSchema,
	ChatSettingsUpdateRequestSchema,
	ProjectCreateRequestSchema,
	ProjectDirectoryBrowseResponseSchema,
	ProjectForkRequestSchema,
	ProjectForkResponseSchema,
	ProjectListResponseSchema,
	ProjectRenameRequestSchema,
	ProjectSummarySchema,
	WorkspaceBrowseResponseSchema,
	WorkspaceFileResponseSchema,
	WorkspaceTreeResponseSchema,
} from "@prime-agent/web-protocol/chat-protocol.zod";
import { type UploadedAttachment, UploadedAttachmentSchema } from "@prime-agent/web-protocol/fleet-contract";
import { z } from "zod/v4";
import { clearChatAuthBearerTokenCache, getChatAuthBearerToken } from "@/lib/auth-stub";
import { ChatRequestError, fetchJson, fetchValidatedJson, metadataUrl, readChatStream } from "./chat-fetch";
import { resolveChatApiUrl } from "./chat-runtime-url";

const ProjectResponseSchema = z.object({ project: ProjectSummarySchema });

export type ChatClient = {
	abortSession: (metadata: ChatSessionMetadata) => Promise<void>;
	answerQuestion: (request: ChatQuestionAnswerRequest) => Promise<ChatQuestionAnswerResponse>;
	browseWorkspace: (path?: string, projectId?: ProjectId) => Promise<WorkspaceBrowseResponse>;
	createSession: (projectId?: ProjectId, signal?: AbortSignal) => Promise<ChatSessionResponse>;
	listProjects: () => Promise<ProjectListResponse>;
	createProject: (request: { path?: string; directoryToken?: string; name?: string }) => Promise<ProjectSummary>;
	renameProject: (projectId: ProjectId, name: string) => Promise<ProjectSummary>;
	unregisterProject: (projectId: ProjectId) => Promise<ProjectSummary>;
	browseProjectDirectories: (options?: { path?: string; token?: string }) => Promise<ProjectDirectoryBrowseResponse>;
	forkSessionIntoProject: (sessionId: string, targetProjectId: ProjectId) => Promise<ProjectForkResponse>;
	getModels: (options?: { scope?: "enabled" | "all"; projectId?: ProjectId }) => Promise<ChatModelsResponse>;
	discoverModels: (request: ChatModelsDiscoverRequest) => Promise<ChatModelsDiscoverResponse>;
	getResources: (projectId?: ProjectId) => Promise<ChatResourcesResponse>;
	getCommands: (projectId?: ProjectId) => Promise<ChatCommandsResponse>;
	getSettings: (projectId?: ProjectId) => Promise<ChatSettingsResponse>;
	getWorkspaceTree: (projectId?: ProjectId) => Promise<WorkspaceTreeResponse>;
	getWorkspaceFile: (path: string, projectId?: ProjectId) => Promise<WorkspaceFileResponse>;
	listSessions: (projectId?: ProjectId) => Promise<Array<ChatSessionInfo>>;
	renameSession: (sessionId: string, title: string) => Promise<void>;
	deleteSession: (sessionId: string) => Promise<void>;
	uploadAttachments: (sessionId: string, files: Array<File>) => Promise<Array<UploadedAttachment>>;
	loadSession: (metadata: ChatSessionMetadata) => Promise<ChatSessionResponse>;
	upsertPlanPresentation: (request: ChatPlanPresentationUpsertRequest) => Promise<ChatPlanPresentation>;
	resumeSession: (metadata: ChatSessionMetadata) => Promise<ChatSessionResponse>;
	updateSettings: (request: ChatSettingsUpdateRequest, projectId?: ProjectId) => Promise<ChatSettingsResponse>;
	streamMessage: (
		request: ChatRequest,
		onEvent: (event: ChatStreamEvent) => void,
		signal?: AbortSignal,
	) => Promise<void>;
	getProviders: () => Promise<{ providers: Array<ChatProviderInfo> }>;
	oauthLoginProvider: (request: ChatProviderOAuthLoginRequest) => Promise<ChatProviderOAuthLoginResponse>;
	updateProvider: (request: ChatProviderUpdateRequest) => Promise<ChatProviderUpdateResponse>;
	removeProvider: (request: ChatProviderRemoveRequest) => Promise<ChatProviderRemoveResponse>;
};

export const chatClient: ChatClient = {
	async abortSession(metadata) {
		await fetchJson("/api/chat/abort", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(metadata),
		});
	},

	async answerQuestion(request) {
		return fetchValidatedJson("/api/chat/question", ChatQuestionAnswerResponseSchema, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(request),
		});
	},

	async browseWorkspace(path, projectId) {
		const params = new URLSearchParams();
		if (projectId) params.set("projectId", projectId);
		if (path && path.trim().length > 0) {
			params.set("path", path);
		}
		const query = params.toString();
		return fetchValidatedJson(`/api/workspace/browse${query ? `?${query}` : ""}`, WorkspaceBrowseResponseSchema);
	},

	async createSession(projectId, signal) {
		return fetchValidatedJson("/api/chat/new", ChatSessionResponseSchema, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(projectId ? { projectId } : {}),
			signal,
		});
	},

	async listProjects() {
		return fetchValidatedJson("/api/projects", ProjectListResponseSchema);
	},

	async createProject(request) {
		const body = ProjectCreateRequestSchema.parse(request);
		const response = await fetchValidatedJson("/api/projects", ProjectResponseSchema, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		return response.project;
	},

	async renameProject(projectId, name) {
		const body = ProjectRenameRequestSchema.parse({ name });
		const response = await fetchValidatedJson(
			`/api/projects?projectId=${encodeURIComponent(projectId)}`,
			ProjectResponseSchema,
			{
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			},
		);
		return response.project;
	},

	async unregisterProject(projectId) {
		const response = await fetchValidatedJson(
			`/api/projects?projectId=${encodeURIComponent(projectId)}`,
			ProjectResponseSchema,
			{
				method: "DELETE",
			},
		);
		return response.project;
	},

	async browseProjectDirectories(options) {
		const params = new URLSearchParams();
		if (options?.path) params.set("path", options.path);
		if (options?.token) params.set("token", options.token);
		const query = params.toString();
		return fetchValidatedJson(
			`/api/projects/browse${query ? `?${query}` : ""}`,
			ProjectDirectoryBrowseResponseSchema,
		);
	},

	async forkSessionIntoProject(sessionId, targetProjectId) {
		const body = ProjectForkRequestSchema.parse({ sessionId, targetProjectId });
		return fetchValidatedJson("/api/projects/fork", ProjectForkResponseSchema, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	},

	async getModels(options) {
		const params = new URLSearchParams();
		if (options?.scope === "all") params.set("scope", "all");
		if (options?.projectId) params.set("projectId", options.projectId);
		const query = params.toString();
		return fetchValidatedJson(`/api/chat/models${query ? `?${query}` : ""}`, ChatModelsResponseSchema);
	},

	async discoverModels(request) {
		return fetchValidatedJson("/api/chat/models/discover", ChatModelsDiscoverResponseSchema, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(ChatModelsDiscoverRequestSchema.parse(request)),
		});
	},

	async getResources(projectId) {
		const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
		return fetchValidatedJson(`/api/chat/resources${query}`, ChatResourcesResponseSchema);
	},

	async getCommands(projectId) {
		const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
		return fetchValidatedJson(`/api/chat/commands${query}`, ChatCommandsResponseSchema);
	},

	async getSettings(projectId) {
		const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
		return fetchValidatedJson(`/api/chat/settings${query}`, ChatSettingsResponseSchema);
	},

	async getWorkspaceTree(projectId) {
		const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
		return fetchValidatedJson(`/api/workspace/tree${query}`, WorkspaceTreeResponseSchema);
	},

	async getWorkspaceFile(path, projectId) {
		const params = new URLSearchParams({ path });
		if (projectId) params.set("projectId", projectId);
		return fetchValidatedJson(`/api/workspace/file?${params}`, WorkspaceFileResponseSchema);
	},

	async listSessions(projectId) {
		const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
		const result = await fetchValidatedJson(`/api/chat/sessions${query}`, ChatSessionsResponseSchema);
		return result.sessions;
	},

	async renameSession(sessionId, title) {
		await fetchJson("/api/chat/sessions", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ sessionId, title }),
		});
	},

	async deleteSession(sessionId) {
		await fetchJson("/api/chat/sessions", {
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ sessionId }),
		});
	},

	async uploadAttachments(sessionId, files) {
		const form = new FormData();
		form.set("sessionId", sessionId);
		for (const file of files) form.append("files", file);
		const response = await fetch(resolveChatApiUrl("/api/chat/session"), {
			method: "POST",
			body: form,
		});
		if (!response.ok) throw new ChatRequestError(response.status, await response.text());
		return z.object({ attachments: z.array(UploadedAttachmentSchema) }).parse(await response.json()).attachments;
	},

	async loadSession(metadata) {
		return fetchValidatedJson(`/api/chat/session?${metadataUrl(metadata)}`, ChatSessionResponseSchema);
	},

	async upsertPlanPresentation(request) {
		const body = ChatPlanPresentationUpsertRequestSchema.parse(request);
		return fetchValidatedJson("/api/chat/session", z.object({ presentation: ChatPlanPresentationSchema }), {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		}).then((result) => result.presentation);
	},
	async resumeSession(metadata) {
		return fetchValidatedJson("/api/chat/resume", ChatSessionResponseSchema, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(metadata),
		});
	},

	async updateSettings(request, projectId) {
		const body = ChatSettingsUpdateRequestSchema.parse(request);
		const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
		return fetchValidatedJson(`/api/chat/settings${query}`, ChatSettingsResponseSchema, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	},

	async streamMessage(request, onEvent, signal) {
		const attempt = async (allowRetry: boolean): Promise<void> => {
			const headers = new Headers({ "Content-Type": "application/json" });
			const bearer = await getChatAuthBearerToken();
			if (bearer) {
				headers.set("Authorization", `Bearer ${bearer}`);
			}

			const response = await fetch(resolveChatApiUrl("/api/chat"), {
				method: "POST",
				headers,
				body: JSON.stringify(request),
				signal,
			});

			if (response.status === 401 && allowRetry) {
				clearChatAuthBearerTokenCache();
				return attempt(false);
			}

			if (!response.ok) {
				const body = await response.text();
				throw new ChatRequestError(response.status, body);
			}

			await readChatStream(response, onEvent);
		};

		await attempt(true);
	},

	async getProviders() {
		return fetchValidatedJson("/api/chat/providers", ChatProvidersResponseSchema);
	},

	async oauthLoginProvider(request) {
		const body = ChatProviderOAuthLoginRequestSchema.parse(request);
		return fetchValidatedJson("/api/chat/providers/oauth", ChatProviderOAuthLoginResponseSchema, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	},

	async updateProvider(request) {
		const body = ChatProviderUpdateRequestSchema.parse(request);
		return fetchValidatedJson("/api/chat/providers", ChatProviderUpdateResponseSchema, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	},

	async removeProvider(request) {
		const body = ChatProviderRemoveRequestSchema.parse(request);
		return fetchValidatedJson("/api/chat/providers", ChatProviderUpdateResponseSchema, {
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	},
};
