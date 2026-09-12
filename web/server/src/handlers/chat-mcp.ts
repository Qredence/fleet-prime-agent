import {
	BUILTIN_MCP_CATALOG,
	createMcpOAuthProvider,
	getCatalogEntry,
	registerBuiltinMcpOAuthProviders,
} from "@earendil-works/pi-ai/mcp";
import type { OAuthLoginCallbacks } from "@earendil-works/pi-ai/oauth";
import { getOAuthProvider, registerOAuthProvider } from "@earendil-works/pi-ai/oauth";
import {
	ChatMcpDeleteRequestSchema,
	ChatMcpOAuthLoginRequestSchema,
	ChatMcpUpsertRequestSchema,
} from "@prime-agent/web-protocol/chat-protocol.zod";
import type { ChatMcpListResponse, ChatMcpOAuthLoginResponse, McpConnectionInfo } from "@prime-agent/web-protocol/mcp";
import {
	confineMcpStdioCwd,
	dropMcpServerCredentials,
	type FleetMcpServerConfig,
	listMcpConnections,
	McpRequestError,
	mcpProviderId,
	validateHttpMcpUrl,
} from "../mcp-connections";
import { getPrimeConfig } from "../prime-config";
import { getBridge } from "../singleton";
import { wrapApiHandler } from "../wrap-api-handler";
import {
	cancelOAuthLogin,
	continueOAuthLogin,
	type OAuthLoginDeps,
	pollOAuthLogin,
	startOAuthLogin,
} from "./chat-providers-oauth";

export type McpHandlerDeps = {
	getUserServers: () => Record<string, FleetMcpServerConfig> | undefined;
	setUserServer: (name: string, config: FleetMcpServerConfig, force: boolean) => void;
	removeUserServer: (name: string) => boolean;
	flushSettings: () => Promise<void>;
	auth: {
		get: (provider: string) => { type?: string; endpoint?: unknown } | undefined;
		removeVerified: (provider: string) => void;
		login: (providerId: string, callbacks: OAuthLoginCallbacks) => Promise<void>;
	};
	workspaceRoot: string;
	env: NodeJS.Dict<string>;
	reloadAuth: () => void;
	reloadResources: () => Promise<void>;
};

function defaultMcpDeps(): McpHandlerDeps {
	const config = getPrimeConfig();
	const settings = config.defaultSettings;
	return {
		getUserServers: () => settings.getGlobalMcpServers() as Record<string, FleetMcpServerConfig> | undefined,
		setUserServer: (name, serverConfig, force) => {
			settings.setGlobalMcpServer(name, serverConfig, force);
		},
		removeUserServer: (name) => settings.removeGlobalMcpServer(name),
		flushSettings: async () => {
			await settings.flush();
			const error = settings.drainErrors("global")[0];
			if (error) throw error.error;
		},
		auth: config.authStorage,
		workspaceRoot: config.defaultCwd,
		env: process.env,
		reloadAuth: () => {
			config.reloadAuth();
		},
		reloadResources: async () => {
			await getBridge().reloadResources();
		},
	};
}

function listedConnections(deps: McpHandlerDeps): Array<McpConnectionInfo> {
	return listMcpConnections(deps.getUserServers(), deps.auth, deps.env);
}

function listResponse(deps: McpHandlerDeps): ChatMcpListResponse {
	return { connections: listedConnections(deps) };
}

function toMcpOAuthResponse(
	snapshot: {
		status: ChatMcpOAuthLoginResponse["status"];
		loginId?: string;
		authUrl?: string;
		userCode?: string;
		instructions?: string;
		prompt?: ChatMcpOAuthLoginResponse["prompt"];
		error?: string;
	},
	connections?: Array<McpConnectionInfo>,
): ChatMcpOAuthLoginResponse {
	return {
		status: snapshot.status,
		...(snapshot.loginId ? { loginId: snapshot.loginId } : {}),
		...(snapshot.authUrl ? { authUrl: snapshot.authUrl } : {}),
		...(snapshot.userCode ? { userCode: snapshot.userCode } : {}),
		...(snapshot.instructions ? { instructions: snapshot.instructions } : {}),
		...(snapshot.prompt ? { prompt: snapshot.prompt } : {}),
		...(snapshot.error ? { error: snapshot.error } : {}),
		...(connections ? { connections } : {}),
	};
}

function ensureMcpOAuthProvider(name: string, deps: McpHandlerDeps): void {
	registerBuiltinMcpOAuthProviders();
	if (getCatalogEntry(name)) return;
	const config = deps.getUserServers()?.[name];
	if (!config || config.type !== "http" || config.oauth !== true) {
		throw new McpRequestError("This MCP server does not use OAuth.");
	}
	registerOAuthProvider(
		createMcpOAuthProvider({
			server: name,
			label: name,
			url: config.url,
		}),
	);
}

function oauthDeps(deps: McpHandlerDeps): OAuthLoginDeps {
	return {
		login: (providerId, callbacks) => deps.auth.login(providerId, callbacks),
		reloadAuth: () => {
			deps.reloadAuth();
			void deps.reloadResources();
		},
		listProviders: () => [],
	};
}

async function logoutMcp(name: string, deps: McpHandlerDeps): Promise<ChatMcpOAuthLoginResponse> {
	try {
		deps.auth.removeVerified(mcpProviderId(name));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new McpRequestError(`Could not remove stored credentials: ${message}`);
	}
	deps.reloadAuth();
	await deps.reloadResources();
	return { status: "success", connections: listedConnections(deps) };
}

export function handleChatMcpGet(_request: Request, deps: McpHandlerDeps = defaultMcpDeps()): Promise<Response> {
	return wrapApiHandler(async () => Response.json(listResponse(deps)), _request);
}

export function handleChatMcpPost(request: Request, deps: McpHandlerDeps = defaultMcpDeps()): Promise<Response> {
	return wrapApiHandler(async () => {
		const body = ChatMcpUpsertRequestSchema.parse(await request.json().catch(() => ({})));
		if (getCatalogEntry(body.name)) {
			throw new McpRequestError(`MCP server name "${body.name}" is reserved for a built-in integration.`);
		}
		const existing = deps.getUserServers()?.[body.name];
		if (existing && body.force !== true) {
			throw new McpRequestError(`MCP server "${body.name}" already exists. Replace it to continue.`);
		}

		let config: FleetMcpServerConfig;
		switch (body.transport) {
			case "http": {
				if (body.bearerTokenEnvVar && body.oauth) {
					throw new McpRequestError("OAuth and a bearer-token environment variable cannot be combined.");
				}
				config = {
					type: "http",
					url: validateHttpMcpUrl(body.url),
					...(body.bearerTokenEnvVar ? { bearerTokenEnvVar: body.bearerTokenEnvVar } : {}),
					...(body.oauth ? { oauth: true } : {}),
				};
				break;
			}
			case "stdio": {
				if (body.command.includes("\0") || body.args?.some((part) => part.includes("\0"))) {
					throw new McpRequestError("MCP command arguments cannot contain NUL.");
				}
				const env = Object.fromEntries((body.env ?? []).map((binding) => [binding.child, { env: binding.source }]));
				const cwd = await confineMcpStdioCwd(body.cwd, deps.workspaceRoot);
				config = {
					type: "stdio",
					command: body.command,
					...(body.args && body.args.length > 0 ? { args: body.args } : {}),
					...(cwd ? { cwd } : {}),
					...(Object.keys(env).length > 0 ? { env } : {}),
				};
				break;
			}
			default: {
				const unexpected: never = body;
				throw new McpRequestError(`Unsupported MCP transport: ${String(unexpected)}`);
			}
		}

		dropMcpServerCredentials(body.name, deps.auth);
		deps.setUserServer(body.name, config, true);
		await deps.flushSettings();
		deps.reloadAuth();
		await deps.reloadResources();
		return Response.json(listResponse(deps));
	}, request);
}

export function handleChatMcpDelete(request: Request, deps: McpHandlerDeps = defaultMcpDeps()): Promise<Response> {
	return wrapApiHandler(async () => {
		const body = ChatMcpDeleteRequestSchema.parse(await request.json().catch(() => ({})));
		if (!deps.removeUserServer(body.name)) {
			throw new McpRequestError(`MCP server "${body.name}" was not found.`);
		}
		await deps.flushSettings();
		dropMcpServerCredentials(body.name, deps.auth);
		deps.reloadAuth();
		await deps.reloadResources();
		return Response.json(listResponse(deps));
	}, request);
}

export function handleChatMcpOAuthPost(request: Request, deps: McpHandlerDeps = defaultMcpDeps()): Promise<Response> {
	return wrapApiHandler(async () => {
		const body = ChatMcpOAuthLoginRequestSchema.parse(await request.json().catch(() => ({})));
		const known = [...BUILTIN_MCP_CATALOG.map((entry) => entry.server), ...Object.keys(deps.getUserServers() ?? {})];
		if (!known.includes(body.name) && !body.loginId) {
			throw new McpRequestError(`Unknown MCP server: ${body.name}`);
		}

		if (body.cancel) {
			if (!body.loginId) {
				return Response.json(
					{ status: "error", error: "loginId is required to cancel" } satisfies ChatMcpOAuthLoginResponse,
					{ status: 400 },
				);
			}
			return Response.json(toMcpOAuthResponse(cancelOAuthLogin(body.loginId)));
		}
		if (body.loginId && body.promptAnswer !== undefined) {
			return Response.json(toMcpOAuthResponse(continueOAuthLogin(body.loginId, body.promptAnswer)));
		}
		if (body.loginId) {
			const snapshot = pollOAuthLogin(body.loginId);
			return Response.json(
				toMcpOAuthResponse(snapshot, snapshot.status === "success" ? listedConnections(deps) : undefined),
			);
		}

		const action = body.action ?? "login";
		switch (action) {
			case "logout":
				return Response.json(await logoutMcp(body.name, deps));
			case "reconnect":
				await logoutMcp(body.name, deps);
				break;
			case "login":
				break;
			default: {
				const unexpected: never = action;
				throw new McpRequestError(`Unsupported MCP OAuth action: ${String(unexpected)}`);
			}
		}

		ensureMcpOAuthProvider(body.name, deps);
		const providerId = mcpProviderId(body.name);
		if (!getOAuthProvider(providerId)) {
			return Response.json(
				{
					status: "error",
					error: `Unknown OAuth provider: ${providerId}`,
				} satisfies ChatMcpOAuthLoginResponse,
				{ status: 400 },
			);
		}

		return Response.json(toMcpOAuthResponse(startOAuthLogin(providerId, oauthDeps(deps))));
	}, request);
}
