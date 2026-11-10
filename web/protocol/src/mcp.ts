import type { z } from "zod/v4";
import type {
	ChatMcpDeleteRequestSchema,
	ChatMcpHttpUpsertRequestSchema,
	ChatMcpListResponseSchema,
	ChatMcpOAuthActionSchema,
	ChatMcpOAuthLoginRequestSchema,
	ChatMcpOAuthLoginResponseSchema,
	ChatMcpStdioUpsertRequestSchema,
	ChatMcpUpsertRequestSchema,
	McpConnectionInfoSchema,
	McpConnectionSourceSchema,
	McpConnectionStatusSchema,
	McpConnectionTransportSchema,
	McpEnvBindingSchema,
} from "./schemas/mcp";

export type McpConnectionSource = z.infer<typeof McpConnectionSourceSchema>;

export type McpConnectionTransport = z.infer<typeof McpConnectionTransportSchema>;

export type McpConnectionStatus = z.infer<typeof McpConnectionStatusSchema>;

export type McpEnvBinding = z.infer<typeof McpEnvBindingSchema>;

export type McpConnectionInfo = z.infer<typeof McpConnectionInfoSchema>;

export type ChatMcpListResponse = z.infer<typeof ChatMcpListResponseSchema>;

export type ChatMcpHttpUpsertRequest = z.infer<typeof ChatMcpHttpUpsertRequestSchema>;

export type ChatMcpStdioUpsertRequest = z.infer<typeof ChatMcpStdioUpsertRequestSchema>;

export type ChatMcpUpsertRequest = z.infer<typeof ChatMcpUpsertRequestSchema>;

export type ChatMcpDeleteRequest = z.infer<typeof ChatMcpDeleteRequestSchema>;

export type ChatMcpOAuthAction = z.infer<typeof ChatMcpOAuthActionSchema>;

export type ChatMcpOAuthLoginRequest = z.infer<typeof ChatMcpOAuthLoginRequestSchema>;

export type ChatMcpOAuthLoginResponse = z.infer<typeof ChatMcpOAuthLoginResponseSchema>;
