export type McpConnectionSource = "builtin" | "user";

export type McpConnectionTransport = "http" | "stdio";

export type McpConnectionStatus = "connected" | "needs_auth" | "disabled" | "anonymous";

export type McpEnvBinding = {
	child: string;
	source: string;
};

export type McpConnectionInfo = {
	name: string;
	label: string;
	source: McpConnectionSource;
	transport: McpConnectionTransport;
	url?: string;
	commandPreview?: string;
	cwdPreview?: string;
	usesOAuth: boolean;
	enabled: boolean;
	status: McpConnectionStatus;
	bearerTokenEnvVar?: string;
	envBindings?: Array<McpEnvBinding>;
	error?: string;
};

export type ChatMcpListResponse = {
	connections: Array<McpConnectionInfo>;
};

export type ChatMcpHttpUpsertRequest = {
	name: string;
	transport: "http";
	url: string;
	oauth?: boolean;
	bearerTokenEnvVar?: string;
	force?: boolean;
};

export type ChatMcpStdioUpsertRequest = {
	name: string;
	transport: "stdio";
	command: string;
	args?: Array<string>;
	cwd?: string;
	env?: Array<McpEnvBinding>;
	force?: boolean;
};

export type ChatMcpUpsertRequest = ChatMcpHttpUpsertRequest | ChatMcpStdioUpsertRequest;

export type ChatMcpDeleteRequest = {
	name: string;
};

export type ChatMcpOAuthAction = "login" | "logout" | "reconnect";

export type ChatMcpOAuthLoginRequest = {
	name: string;
	action?: ChatMcpOAuthAction;
	loginId?: string;
	promptAnswer?: string;
	cancel?: boolean;
};

export type ChatMcpOAuthLoginResponse = {
	status: "waiting" | "success" | "error";
	loginId?: string;
	authUrl?: string;
	userCode?: string;
	instructions?: string;
	prompt?: {
		message: string;
		placeholder?: string;
		allowEmpty?: boolean;
	};
	error?: string;
	connections?: Array<McpConnectionInfo>;
};
