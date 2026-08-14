import type {
	WorkspaceBrowseResponse,
	WorkspaceFileResponse,
	WorkspaceRootRequest,
	WorkspaceRootResponse,
	WorkspaceTreeNode,
	WorkspaceTreeResponse,
} from "../chat-protocol";
import { ChatThinkingLevelSchema, z } from "./shared";

export const ChatModelInfoSchema = z
	.object({
		key: z.string(),
		provider: z.string(),
		id: z.string(),
		name: z.string(),
		version: z.string().optional(),
		reasoning: z.boolean(),
		input: z.array(z.enum(["text", "image"])),
		contextWindow: z.number().optional(),
		maxTokens: z.number().optional(),
		available: z.boolean(),
		defaultThinkingLevel: ChatThinkingLevelSchema.optional(),
		thinkingLevels: z.array(ChatThinkingLevelSchema).optional(),
	})
	.openapi({ description: "Chat model info" });

export const ChatModelsResponseSchema = z
	.object({
		models: z.array(ChatModelInfoSchema),
		selectedModelKey: z.string().optional(),
		defaultProvider: z.string().optional(),
		defaultModel: z.string().optional(),
		defaultThinkingLevel: ChatThinkingLevelSchema.optional(),
		diagnostics: z.array(z.string()),
	})
	.openapi({ description: "Chat models response" });

export const ChatModelsDiscoverRequestSchema = z
	.object({
		providerId: z.string().min(1).max(128),
	})
	.openapi({ description: "Discover models for a provider" });

export const ChatModelsDiscoverResponseSchema = z
	.object({
		providerId: z.string(),
		models: z.array(ChatModelInfoSchema),
	})
	.openapi({ description: "Discovered models for a provider" });

export const ChatResourceInfoSchema = z
	.object({
		activationStatus: z.enum(["active", "staged", "reload-required"]).optional(),
		name: z.string(),
		description: z.string().optional(),
		installedInWorkspace: z.boolean().optional(),
		path: z.string().optional(),
		source: z.string().optional(),
		workspacePath: z.string().optional(),
		argumentHint: z.string().optional(),
	})
	.openapi({ description: "Chat resource info" });

export const ChatResourcesResponseSchema = z
	.object({
		packages: z.array(ChatResourceInfoSchema),
		skills: z.array(ChatResourceInfoSchema),
		prompts: z.array(ChatResourceInfoSchema),
		extensions: z.array(ChatResourceInfoSchema),
		themes: z.array(ChatResourceInfoSchema),
		agentsFiles: z.array(ChatResourceInfoSchema),
		diagnostics: z.array(z.string()),
	})
	.openapi({ description: "Chat resources response" });

export const WorkspaceTreeNodeSchema: z.ZodType<WorkspaceTreeNode> = z.lazy(() =>
	z.object({
		name: z.string(),
		path: z.string(),
		type: z.enum(["directory", "file"]),
		children: z.array(WorkspaceTreeNodeSchema).optional(),
	}),
);

export const WorkspaceTreeResponseSchema: z.ZodType<WorkspaceTreeResponse> = z
	.object({
		root: z.string(),
		nodes: z.array(WorkspaceTreeNodeSchema),
		diagnostics: z.array(z.string()),
	})
	.openapi({ description: "Workspace tree response" });

export const WorkspaceFileResponseSchema: z.ZodType<WorkspaceFileResponse> = z
	.object({
		path: z.string(),
		name: z.string(),
		content: z.string(),
		mediaType: z.enum(["text/markdown", "text/plain", "application/octet-stream"]),
		size: z.number().optional(),
		status: z.enum(["ok", "too-large", "unsupported"]).optional(),
	})
	.openapi({ description: "Workspace file preview response" });

export const WorkspaceBrowseEntrySchema = z
	.object({
		name: z.string(),
		path: z.string(),
	})
	.openapi({ description: "Directory entry in the project-folder picker" });

export const WorkspaceBrowseResponseSchema: z.ZodType<WorkspaceBrowseResponse> = z
	.object({
		path: z.string(),
		parent: z.string().nullable(),
		entries: z.array(WorkspaceBrowseEntrySchema),
	})
	.openapi({ description: "Workspace directory browse response" });

export const WorkspaceRootRequestSchema: z.ZodType<WorkspaceRootRequest> = z
	.object({
		path: z.string().min(1),
	})
	.openapi({ description: "Set workspace / agent root request" });

export const WorkspaceRootResponseSchema: z.ZodType<WorkspaceRootResponse> = z
	.object({
		root: z.string(),
	})
	.openapi({ description: "Set workspace / agent root response" });

export const ChatProviderInfoSchema = z
	.object({
		id: z.string(),
		name: z.string(),
		isConfigured: z.boolean(),
		envVarName: z.string(),
		authType: z.enum(["apiKey", "oauth"]).optional(),
		providerFamily: z.string().optional(),
		displayName: z.string().optional(),
		api: z.enum(["openai-completions", "openai-responses", "anthropic-messages", "google-genai"]).optional(),
		modelIds: z.array(z.string().max(4096)).max(64).optional(),
	})
	.openapi({ description: "Chat provider info" });

export const ChatProvidersResponseSchema = z
	.object({
		providers: z.array(ChatProviderInfoSchema),
	})
	.openapi({ description: "Chat providers response" });

export const ChatProviderUpdateRequestSchema = z
	.object({
		providerId: z.string(),
		apiKey: z.string().max(4096),
		baseUrl: z.string().max(4096).optional(),
		modelId: z.string().max(4096).optional(),
		displayName: z.string().max(256).optional(),
		createOccInstance: z.boolean().optional(),
		api: z.enum(["openai-completions", "openai-responses", "anthropic-messages", "google-genai"]).optional(),
		models: z.array(z.string().max(4096)).max(64).optional(),
	})
	.openapi({ description: "Chat provider update request" });

export const ChatProviderUpdateResponseSchema = z
	.object({
		success: z.boolean(),
		providers: z.array(ChatProviderInfoSchema),
		reloadRequired: z.boolean().optional(),
	})
	.openapi({ description: "Chat provider update response" });

export const ChatProviderRemoveRequestSchema = z
	.object({
		providerId: z.string(),
	})
	.openapi({ description: "Chat provider remove request" });

export const ChatProviderRemoveResponseSchema = ChatProviderUpdateResponseSchema.openapi({
	description: "Chat provider remove response",
});

export const ChatProviderOAuthLoginStatusSchema = z
	.enum(["waiting", "success", "error"])
	.openapi({ description: "OAuth login status" });

export const ChatProviderOAuthPromptSchema = z
	.object({
		message: z.string(),
		placeholder: z.string().optional(),
		allowEmpty: z.boolean().optional(),
	})
	.openapi({ description: "Interactive OAuth prompt" });

export const ChatProviderOAuthLoginRequestSchema = z
	.object({
		providerId: z.string().min(1),
		loginId: z.string().min(1).optional(),
		promptAnswer: z.string().max(8192).optional(),
		cancel: z.boolean().optional(),
	})
	.openapi({ description: "Chat provider OAuth login request" });

export const ChatProviderOAuthLoginResponseSchema = z
	.object({
		status: ChatProviderOAuthLoginStatusSchema,
		loginId: z.string().optional(),
		authUrl: z.string().optional(),
		userCode: z.string().optional(),
		instructions: z.string().optional(),
		prompt: ChatProviderOAuthPromptSchema.optional(),
		error: z.string().optional(),
		providers: z.array(ChatProviderInfoSchema).optional(),
	})
	.openapi({ description: "Chat provider OAuth login response" });

export const ChatSlashCommandInfoSchema = z
	.object({
		name: z.string(),
		description: z.string().optional(),
		argumentHint: z.string().optional(),
		source: z.enum(["builtin", "extension", "prompt", "skill"]),
		passThrough: z.boolean().optional(),
	})
	.openapi({ description: "Chat slash command info" });

export const ChatCommandsResponseSchema = z
	.object({
		commands: z.array(ChatSlashCommandInfoSchema),
		diagnostics: z.array(z.string()),
	})
	.openapi({ description: "Chat slash commands response" });
