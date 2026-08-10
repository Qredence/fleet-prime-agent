import {
  ChatCommandsResponseSchema,
  ChatModelsDiscoverRequestSchema,
  ChatModelsDiscoverResponseSchema,
  ChatModelsResponseSchema,
  ChatProviderRemoveRequestSchema,
  ChatProviderUpdateRequestSchema,
  ChatProviderUpdateResponseSchema,
  ChatProvidersResponseSchema,
  ChatQuestionAnswerResponseSchema,
  ChatResourcesResponseSchema,
  ChatSessionResponseSchema,
  ChatSessionsResponseSchema,
  ChatSettingsResponseSchema,
  ChatSettingsUpdateRequestSchema,
  WorkspaceTreeResponseSchema,
} from "@prime-agent/web-protocol/chat-protocol.zod"
import {
  ChatRequestError,
  fetchJson,
  fetchValidatedJson,
  metadataUrl,
  readChatStream,
} from "./chat-fetch"
import { resolveChatApiUrl } from "./chat-runtime-url"
import type {
  ChatCommandsResponse,
  ChatModelsDiscoverRequest,
  ChatModelsDiscoverResponse,
  ChatModelsResponse,
  ChatProviderInfo,
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
  WorkspaceTreeResponse,
} from "@prime-agent/web-protocol/chat-protocol"
import {
  clearChatAuthBearerTokenCache,
  getChatAuthBearerToken,
} from "@/lib/auth-stub"

export type ChatClient = {
  abortSession: (metadata: ChatSessionMetadata) => Promise<void>
  answerQuestion: (
    request: ChatQuestionAnswerRequest
  ) => Promise<ChatQuestionAnswerResponse>
  createSession: () => Promise<ChatSessionResponse>
  getModels: (options?: {
    scope?: "enabled" | "all"
  }) => Promise<ChatModelsResponse>
  discoverModels: (
    request: ChatModelsDiscoverRequest
  ) => Promise<ChatModelsDiscoverResponse>
  getResources: () => Promise<ChatResourcesResponse>
  getCommands: () => Promise<ChatCommandsResponse>
  getSettings: () => Promise<ChatSettingsResponse>
  getWorkspaceTree: () => Promise<WorkspaceTreeResponse>
  listSessions: () => Promise<Array<ChatSessionInfo>>
  loadSession: (metadata: ChatSessionMetadata) => Promise<ChatSessionResponse>
  resumeSession: (metadata: ChatSessionMetadata) => Promise<ChatSessionResponse>
  updateSettings: (
    request: ChatSettingsUpdateRequest
  ) => Promise<ChatSettingsResponse>
  streamMessage: (
    request: ChatRequest,
    onEvent: (event: ChatStreamEvent) => void,
    signal?: AbortSignal
  ) => Promise<void>
  getProviders: () => Promise<{ providers: Array<ChatProviderInfo> }>
  updateProvider: (
    request: ChatProviderUpdateRequest
  ) => Promise<ChatProviderUpdateResponse>
  removeProvider: (
    request: ChatProviderRemoveRequest
  ) => Promise<ChatProviderRemoveResponse>
}

export const chatClient: ChatClient = {
  async abortSession(metadata) {
    await fetchJson("/api/chat/abort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(metadata),
    })
  },

  async answerQuestion(request) {
    return fetchValidatedJson(
      "/api/chat/question",
      ChatQuestionAnswerResponseSchema,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      }
    )
  },

  async createSession() {
    return fetchValidatedJson("/api/chat/new", ChatSessionResponseSchema, {
      method: "POST",
    })
  },

  async getModels(options) {
    const params = options?.scope === "all" ? "?scope=all" : ""
    return fetchValidatedJson(
      `/api/chat/models${params}`,
      ChatModelsResponseSchema
    )
  },

  async discoverModels(request) {
    return fetchValidatedJson(
      "/api/chat/models/discover",
      ChatModelsDiscoverResponseSchema,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ChatModelsDiscoverRequestSchema.parse(request)),
      }
    )
  },

  async getResources() {
    return fetchValidatedJson(
      "/api/chat/resources",
      ChatResourcesResponseSchema
    )
  },

  async getCommands() {
    return fetchValidatedJson("/api/chat/commands", ChatCommandsResponseSchema)
  },

  async getSettings() {
    return fetchValidatedJson("/api/chat/settings", ChatSettingsResponseSchema)
  },

  async getWorkspaceTree() {
    return fetchValidatedJson(
      "/api/workspace/tree",
      WorkspaceTreeResponseSchema
    )
  },

  async listSessions() {
    const result = await fetchValidatedJson(
      "/api/chat/sessions",
      ChatSessionsResponseSchema
    )
    return result.sessions
  },

  async loadSession(metadata) {
    return fetchValidatedJson(
      `/api/chat/session?${metadataUrl(metadata)}`,
      ChatSessionResponseSchema
    )
  },

  async resumeSession(metadata) {
    return fetchValidatedJson("/api/chat/resume", ChatSessionResponseSchema, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(metadata),
    })
  },

  async updateSettings(request) {
    const body = ChatSettingsUpdateRequestSchema.parse(request)
    return fetchValidatedJson(
      "/api/chat/settings",
      ChatSettingsResponseSchema,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    )
  },

  async streamMessage(request, onEvent, signal) {
    const attempt = async (allowRetry: boolean): Promise<void> => {
      const headers = new Headers({ "Content-Type": "application/json" })
      const bearer = await getChatAuthBearerToken()
      if (bearer) {
        headers.set("Authorization", `Bearer ${bearer}`)
      }

      const response = await fetch(resolveChatApiUrl("/api/chat"), {
        method: "POST",
        headers,
        body: JSON.stringify(request),
        signal,
      })

      if (response.status === 401 && allowRetry) {
        clearChatAuthBearerTokenCache()
        return attempt(false)
      }

      if (!response.ok) {
        const body = await response.text()
        throw new ChatRequestError(response.status, body)
      }

      await readChatStream(response, onEvent)
    }

    await attempt(true)
  },

  async getProviders() {
    return fetchValidatedJson(
      "/api/chat/providers",
      ChatProvidersResponseSchema
    )
  },

  async updateProvider(request) {
    const body = ChatProviderUpdateRequestSchema.parse(request)
    return fetchValidatedJson(
      "/api/chat/providers",
      ChatProviderUpdateResponseSchema,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    )
  },

  async removeProvider(request) {
    const body = ChatProviderRemoveRequestSchema.parse(request)
    return fetchValidatedJson(
      "/api/chat/providers",
      ChatProviderUpdateResponseSchema,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    )
  },
}
