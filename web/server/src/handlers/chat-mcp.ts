import { BUILTIN_MCP_CATALOG, getCatalogEntry } from "@earendil-works/pi-ai/mcp";
import {
	ChatMcpDeleteRequestSchema,
	ChatMcpOAuthLoginRequestSchema,
	ChatMcpTokenRequestSchema,
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
import { type McpCredentialOutcome, storeMcpStaticToken } from "../mcp-daemon-credentials";
import { listDaemonMcpConnections } from "../mcp-daemon-list";
import { getPrimeConfig } from "../prime-config";
import { getBridge } from "../singleton";
import { wrapApiHandler } from "../wrap-api-handler";

export type McpHandlerDeps = {
	getUserServers: () => Record<string, FleetMcpServerConfig> | undefined;
	setUserServer: (name: string, config: FleetMcpServerConfig, force: boolean) => void;
	removeUserServer: (name: string) => boolean;
	flushSettings: () => Promise<void>;
	auth: {
		get: (provider: string) => { type?: string; endpoint?: unknown } | undefined;
		removeVerified: (provider: string) => void;
	};
	workspaceRoot: string;
	env: NodeJS.Dict<string>;
	reloadAuth: () => void;
	reloadResources: () => Promise<void>;
	/**
	 * The daemon's MCP view, which owns the configuration.
	 *
	 * Injected rather than imported so the handlers stay testable without a live
	 * daemon, the same way every other operation here goes through `deps`.
	 */
	listConnections: (cwd: string) => Promise<McpConnectionInfo[]>;
	/** Stores a static token through the daemon, which owns the credential. */
	storeToken: (cwd: string, server: string, token: string) => Promise<McpCredentialOutcome>;
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
		listConnections: listDaemonMcpConnections,
		storeToken: storeMcpStaticToken,
	};
}

function listedConnections(deps: McpHandlerDeps): Array<McpConnectionInfo> {
	return listMcpConnections(deps.getUserServers(), deps.auth, deps.env);
}

function listResponse(deps: McpHandlerDeps): ChatMcpListResponse {
	return { connections: listedConnections(deps) };
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
	return wrapApiHandler(async () => {
		// The daemon owns MCP configuration and verifies credentials, so its view
		// is authoritative. The SDK-based list reported a server as connected
		// whenever a credential object existed, which hid expired tokens.
		//
		// A daemon failure surfaces rather than falling back to that list: silently
		// showing stale "connected" rows is the bug this replaced.
		const connections = await deps.listConnections(deps.workspaceRoot);
		return Response.json({ connections } satisfies ChatMcpListResponse);
	}, _request);
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
		if (!known.includes(body.name)) {
			throw new McpRequestError(`Unknown MCP server: ${body.name}`);
		}

		const action = body.action ?? "login";
		if (action === "logout") return Response.json(await logoutMcp(body.name, deps));

		return Response.json(
			{
				status: "error",
				error: "MCP OAuth sign-in is unavailable in Fleet settings. Launch Prime Agent in a terminal using the same configuration directory as Fleet and complete MCP sign-in there. Restart Fleet afterward to reload the credentials.",
			} satisfies ChatMcpOAuthLoginResponse,
			{ status: 501 },
		);
	}, request);
}

/**
 * Stores a pasted token through the daemon.
 *
 * A failed verification still stores the credential, so it answers 200 and
 * reports `verified: false` with a reason rather than pretending the write
 * failed.
 */
export function handleChatMcpTokenPost(request: Request, deps: McpHandlerDeps = defaultMcpDeps()): Promise<Response> {
	return wrapApiHandler(async () => {
		const body = ChatMcpTokenRequestSchema.parse(await request.json().catch(() => ({})));
		const outcome = await deps.storeToken(deps.workspaceRoot, body.name, body.token);
		if (outcome.status !== "stored") {
			const reason = outcome.status === "refused" ? outcome.reason : "The token was not stored.";
			throw new McpRequestError(reason);
		}
		deps.reloadAuth();
		await deps.reloadResources();
		return Response.json({
			verified: outcome.verified,
			toolCount: outcome.toolCount,
			...(outcome.error ? { error: outcome.error } : {}),
			connections: listedConnections(deps),
		});
	}, request);
}
