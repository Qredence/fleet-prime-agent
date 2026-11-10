import { ChatThinkingLevelSchema, z } from "./shared";

export const ChatModelInfoSchema = z.object({
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
});

export const ChatModelsResponseSchema = z.object({
	models: z.array(ChatModelInfoSchema),
	selectedModelKey: z.string().optional(),
	defaultProvider: z.string().optional(),
	defaultModel: z.string().optional(),
	defaultThinkingLevel: ChatThinkingLevelSchema.optional(),
	diagnostics: z.array(z.string()),
});

export const ChatModelsDiscoverRequestSchema = z.object({
	providerId: z.string().min(1).max(128),
});

export const ChatModelsDiscoverResponseSchema = z.object({
	providerId: z.string(),
	error: z.string().optional(),
	models: z.array(ChatModelInfoSchema),
});

export const ChatResourceInfoSchema = z.object({
	activationStatus: z.enum(["active", "staged", "reload-required"]).optional(),
	name: z.string(),
	description: z.string().optional(),
	installedInWorkspace: z.boolean().optional(),
	path: z.string().optional(),
	source: z.string().optional(),
	workspacePath: z.string().optional(),
	argumentHint: z.string().optional(),
});

export const ChatResourcesResponseSchema = z.object({
	packages: z.array(ChatResourceInfoSchema),
	skills: z.array(ChatResourceInfoSchema),
	prompts: z.array(ChatResourceInfoSchema),
	extensions: z.array(ChatResourceInfoSchema),
	themes: z.array(ChatResourceInfoSchema),
	agentsFiles: z.array(ChatResourceInfoSchema),
	diagnostics: z.array(z.string()),
});

export type WorkspaceTreeNode = {
	name: string;
	path: string;
	type: "directory" | "file";
	children?: Array<WorkspaceTreeNode>;
};

export const WorkspaceTreeNodeSchema: z.ZodType<WorkspaceTreeNode> = z.lazy(() =>
	z.object({
		name: z.string(),
		path: z.string(),
		type: z.enum(["directory", "file"]),
		children: z.array(WorkspaceTreeNodeSchema).optional(),
	}),
);

export const WorkspaceTreeResponseSchema = z.object({
	root: z.string(),
	nodes: z.array(WorkspaceTreeNodeSchema),
	diagnostics: z.array(z.string()),
});

export const WorkspaceFileResponseSchema = z.object({
	path: z.string(),
	name: z.string(),
	content: z.string(),
	mediaType: z.enum(["text/markdown", "text/plain", "application/octet-stream"]),
	size: z.number().optional(),
	status: z.enum(["ok", "too-large", "unsupported"]).optional(),
});

export const WorkspaceBrowseEntrySchema = z.object({
	name: z.string(),
	path: z.string(),
});

export const WorkspaceBrowseResponseSchema = z.object({
	path: z.string(),
	parent: z.string().nullable(),
	entries: z.array(WorkspaceBrowseEntrySchema),
});

export const PiCustomProviderApiSchema = z.enum([
	"openai-completions",
	"openai-responses",
	"anthropic-messages",
	"google-genai",
]);

export const ChatProviderInfoSchema = z.object({
	id: z.string(),
	name: z.string(),
	isConfigured: z.boolean(),
	envVarName: z.string(),
	authType: z.enum(["apiKey", "oauth"]).optional(),
	supportsOAuth: z.boolean().optional(),
	providerFamily: z.string().optional(),
	displayName: z.string().optional(),
	api: PiCustomProviderApiSchema.optional(),
	baseUrl: z.string().optional(),
	modelIds: z.array(z.string().max(4096)).optional(),
	discoverable: z.boolean().optional(),
});

export const ChatProvidersResponseSchema = z.object({
	providers: z.array(ChatProviderInfoSchema),
});

export const ChatProviderUpdateRequestSchema = z.object({
	providerId: z.string(),
	apiKey: z.string().max(4096),
	baseUrl: z.string().max(4096).optional(),
	modelId: z.string().max(4096).optional(),
	displayName: z.string().max(256).optional(),
	createOccInstance: z.boolean().optional(),
	api: PiCustomProviderApiSchema.optional(),
	models: z.array(z.string().max(4096)).optional(),
});

export const ChatProviderUpdateResponseSchema = z.object({
	success: z.boolean(),
	providers: z.array(ChatProviderInfoSchema),
	reloadRequired: z.boolean().optional(),
});

export const ChatProviderRemoveRequestSchema = z.object({
	providerId: z.string(),
});

export const ChatProviderRemoveResponseSchema = ChatProviderUpdateResponseSchema;

export const ChatProviderOAuthLoginStatusSchema = z.enum(["waiting", "success", "error"]);

export const ChatProviderOAuthPromptSchema = z.object({
	message: z.string(),
	placeholder: z.string().optional(),
	allowEmpty: z.boolean().optional(),
});

export const ChatProviderOAuthLoginRequestSchema = z.object({
	providerId: z.string().min(1),
	loginId: z.string().min(1).optional(),
	promptAnswer: z.string().max(8192).optional(),
	cancel: z.boolean().optional(),
});

export const ChatProviderOAuthLoginResponseSchema = z.object({
	status: ChatProviderOAuthLoginStatusSchema,
	loginId: z.string().optional(),
	authUrl: z.string().optional(),
	userCode: z.string().optional(),
	instructions: z.string().optional(),
	prompt: ChatProviderOAuthPromptSchema.optional(),
	error: z.string().optional(),
	providers: z.array(ChatProviderInfoSchema).optional(),
});

export const ChatSlashCommandSourceSchema = z.enum(["builtin", "extension", "prompt", "skill"]);

export const ChatSlashCommandInfoSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	argumentHint: z.string().optional(),
	source: ChatSlashCommandSourceSchema,
	passThrough: z.boolean().optional(),
});

export const ChatCommandsResponseSchema = z.object({
	commands: z.array(ChatSlashCommandInfoSchema),
	diagnostics: z.array(z.string()),
});
