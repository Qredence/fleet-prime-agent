import { ChatProviderOAuthLoginStatusSchema, ChatProviderOAuthPromptSchema } from "./catalog";
import { nonEmptyStringSchema, z } from "./shared";

export const MCP_SERVER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export const MCP_ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const mcpServerNameSchema = z
	.string()
	.regex(
		MCP_SERVER_NAME_PATTERN,
		"MCP server names must be 1-64 letters, numbers, underscores, or hyphens and start with a letter or number.",
	);

const mcpEnvNameSchema = z
	.string()
	.regex(MCP_ENV_NAME_PATTERN, "Environment variable names must be letters, digits, or underscores.");

export const McpConnectionSourceSchema = z.enum(["builtin", "user"]);
export const McpConnectionTransportSchema = z.enum(["http", "stdio"]);
export const McpConnectionStatusSchema = z.enum(["connected", "needs_auth", "disabled", "anonymous"]);

export const McpEnvBindingSchema = z
	.object({
		child: mcpEnvNameSchema,
		source: mcpEnvNameSchema,
	})
	.openapi({ description: "Stdio env mapping as CHILD=SOURCE variable names only" });

export const McpConnectionInfoSchema = z
	.object({
		name: mcpServerNameSchema,
		label: nonEmptyStringSchema,
		source: McpConnectionSourceSchema,
		transport: McpConnectionTransportSchema,
		url: z.string().optional(),
		commandPreview: z.string().optional(),
		cwdPreview: z.string().optional(),
		usesOAuth: z.boolean(),
		enabled: z.boolean(),
		status: McpConnectionStatusSchema,
		bearerTokenEnvVar: z.string().optional(),
		envBindings: z.array(McpEnvBindingSchema).optional(),
		error: z.string().optional(),
	})
	.openapi({ description: "Browser-safe MCP connection row; never includes tokens or env values" });

export const ChatMcpListResponseSchema = z
	.object({
		connections: z.array(McpConnectionInfoSchema),
	})
	.openapi({ description: "MCP connection list" });

const ChatMcpHttpUpsertRequestSchema = z.object({
	name: mcpServerNameSchema,
	transport: z.literal("http"),
	url: nonEmptyStringSchema,
	oauth: z.boolean().optional(),
	bearerTokenEnvVar: mcpEnvNameSchema.optional(),
	force: z.boolean().optional(),
});

const ChatMcpStdioUpsertRequestSchema = z.object({
	name: mcpServerNameSchema,
	transport: z.literal("stdio"),
	command: nonEmptyStringSchema,
	args: z.array(z.string().min(1).max(1024)).max(32).optional(),
	cwd: z.string().min(1).max(1024).optional(),
	env: z.array(McpEnvBindingSchema).max(32).optional(),
	force: z.boolean().optional(),
});

export const ChatMcpUpsertRequestSchema = z
	.discriminatedUnion("transport", [ChatMcpHttpUpsertRequestSchema, ChatMcpStdioUpsertRequestSchema])
	.openapi({ description: "Add or replace a user MCP server" });

export const ChatMcpDeleteRequestSchema = z
	.object({
		name: mcpServerNameSchema,
	})
	.openapi({ description: "Remove a user MCP server" });

export const ChatMcpOAuthActionSchema = z.enum(["login", "logout", "reconnect"]);

export const ChatMcpOAuthLoginRequestSchema = z
	.object({
		name: mcpServerNameSchema,
		action: ChatMcpOAuthActionSchema.optional(),
		loginId: z.string().min(1).optional(),
		promptAnswer: z.string().max(8192).optional(),
		cancel: z.boolean().optional(),
	})
	.openapi({ description: "MCP OAuth login, logout, or reconnect" });

export const ChatMcpOAuthLoginResponseSchema = z
	.object({
		status: ChatProviderOAuthLoginStatusSchema,
		loginId: z.string().optional(),
		authUrl: z.string().optional(),
		userCode: z.string().optional(),
		instructions: z.string().optional(),
		prompt: ChatProviderOAuthPromptSchema.optional(),
		error: z.string().optional(),
		connections: z.array(McpConnectionInfoSchema).optional(),
	})
	.openapi({ description: "MCP OAuth login snapshot" });
