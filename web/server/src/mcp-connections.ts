import { realpath } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { BUILTIN_MCP_CATALOG, getCatalogEntry } from "@earendil-works/pi-ai/mcp";
import type { McpConnectionInfo, McpConnectionStatus, McpEnvBinding } from "@prime-agent/web-protocol/mcp";
import { safePathLabel } from "./project-registry";

export type FleetMcpHttpConfig = {
	type: "http";
	url: string;
	bearerTokenEnvVar?: string;
	oauth?: boolean;
	enabled?: boolean;
};

export type FleetMcpStdioConfig = {
	type: "stdio";
	command: string;
	args?: Array<string>;
	cwd?: string;
	env?: Record<string, { env: string }>;
	enabled?: boolean;
};

export type FleetMcpServerConfig = FleetMcpHttpConfig | FleetMcpStdioConfig;

export const MCP_AUTH_PREFIX = "mcp:";

export function mcpProviderId(name: string): string {
	return `${MCP_AUTH_PREFIX}${name}`;
}

export class McpRequestError extends Error {
	readonly status: 400 = 400;
	constructor(message: string) {
		super(message);
		this.name = "McpRequestError";
	}
}

export type McpAuthRecord = {
	type?: string;
	endpoint?: unknown;
};

export type McpAuthStore = {
	get(provider: string): McpAuthRecord | undefined;
	removeVerified(provider: string): void;
};

export type McpListedServer = {
	name: string;
	label: string;
	source: McpConnectionInfo["source"];
	config: FleetMcpServerConfig;
	userDeclared: boolean;
};

export function validateHttpMcpUrl(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new McpRequestError("Invalid MCP URL.");
	}
	if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname || url.username || url.password) {
		throw new McpRequestError("MCP URL must be an http(s) URL without embedded credentials.");
	}
	return url.toString();
}

export function stdioCommandPreview(config: FleetMcpStdioConfig): string {
	return [config.command, ...(config.args ?? [])].join(" ");
}

export function mcpEnvBindings(config: FleetMcpServerConfig): Array<McpEnvBinding> | undefined {
	if (config.type !== "stdio" || !config.env) return undefined;
	const bindings = Object.entries(config.env).map(([child, mapping]) => ({ child, source: mapping.env }));
	return bindings.length > 0 ? bindings : undefined;
}

export function isMcpAuthed(server: McpListedServer, auth: McpAuthStore, env: NodeJS.Dict<string>): boolean {
	if (server.config.enabled === false) return false;
	if (server.userDeclared && getCatalogEntry(server.name)) return false;
	if (server.config.type === "stdio") return true;
	const usesOAuth = server.config.type === "http" && server.config.oauth === true;
	const bearerTokenEnvVar = server.config.type === "http" ? server.config.bearerTokenEnvVar : undefined;
	if (!usesOAuth && !bearerTokenEnvVar) return true;
	if (bearerTokenEnvVar && env[bearerTokenEnvVar]?.trim()) return true;
	const cred = auth.get(mcpProviderId(server.name));
	if (cred === undefined) return false;
	if (!server.userDeclared) return true;
	const endpoint = cred.endpoint;
	return typeof endpoint === "string" && server.config.type === "http" && endpoint === server.config.url;
}

export function mcpConnectionStatus(server: McpListedServer, authed: boolean): McpConnectionStatus {
	if (server.config.enabled === false) return "disabled";
	if (authed) {
		const anonymousHttp =
			server.config.type === "http" && server.config.oauth !== true && !server.config.bearerTokenEnvVar;
		return anonymousHttp ? "anonymous" : "connected";
	}
	return "needs_auth";
}

export function toMcpConnectionInfo(
	server: McpListedServer,
	auth: McpAuthStore,
	env: NodeJS.Dict<string>,
): McpConnectionInfo {
	const usesOAuth = server.config.type === "http" && server.config.oauth === true;
	const catalogShadow = server.userDeclared && Boolean(getCatalogEntry(server.name));
	const authed = isMcpAuthed(server, auth, env);
	const envBindings = mcpEnvBindings(server.config);
	return {
		name: server.name,
		label: server.label,
		source: server.source,
		transport: server.config.type,
		usesOAuth,
		enabled: authed,
		status: mcpConnectionStatus(server, authed),
		...(server.config.type === "http" ? { url: server.config.url } : {}),
		...(server.config.type === "stdio" ? { commandPreview: stdioCommandPreview(server.config) } : {}),
		...(server.config.type === "stdio" && server.config.cwd ? { cwdPreview: safePathLabel(server.config.cwd) } : {}),
		...(server.config.type === "http" && server.config.bearerTokenEnvVar
			? { bearerTokenEnvVar: server.config.bearerTokenEnvVar }
			: {}),
		...(envBindings ? { envBindings } : {}),
		...(catalogShadow ? { error: "This name is reserved for a built-in integration." } : {}),
	};
}

export function listMcpServers(userServers: Record<string, FleetMcpServerConfig> | undefined): Array<McpListedServer> {
	const listed: Array<McpListedServer> = [];
	for (const entry of BUILTIN_MCP_CATALOG) {
		listed.push({
			name: entry.server,
			label: entry.label,
			source: "builtin",
			userDeclared: false,
			config: { type: "http", url: entry.url, oauth: true },
		});
	}
	for (const [name, config] of Object.entries(userServers ?? {}).sort(([left], [right]) =>
		left.localeCompare(right),
	)) {
		listed.push({
			name,
			label: name,
			source: "user",
			userDeclared: true,
			config,
		});
	}
	return listed;
}

export function listMcpConnections(
	userServers: Record<string, FleetMcpServerConfig> | undefined,
	auth: McpAuthStore,
	env: NodeJS.Dict<string> = process.env,
): Array<McpConnectionInfo> {
	return listMcpServers(userServers).map((server) => toMcpConnectionInfo(server, auth, env));
}

export function dropMcpServerCredentials(name: string, auth: McpAuthStore): void {
	if (getCatalogEntry(name)) return;
	try {
		auth.removeVerified(mcpProviderId(name));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new McpRequestError(`Could not remove stored credentials for this MCP server: ${message}`);
	}
}

export async function confineMcpStdioCwd(cwd: string | undefined, workspaceRoot: string): Promise<string | undefined> {
	if (cwd === undefined || cwd.trim() === "") return undefined;
	const root = resolve(workspaceRoot);
	const canonicalRoot = await realpath(root).catch(() => root);
	const candidate = resolve(root, cwd);
	const existingCandidate = await realpath(candidate).catch(() => undefined);
	if (
		existingCandidate &&
		existingCandidate !== canonicalRoot &&
		!existingCandidate.startsWith(`${canonicalRoot}${sep}`)
	) {
		throw new McpRequestError("MCP stdio working directory must stay inside the workspace.");
	}
	let ancestor = dirname(candidate);
	while (true) {
		const resolvedAncestor = await realpath(ancestor).catch(() => undefined);
		if (resolvedAncestor) {
			if (resolvedAncestor !== canonicalRoot && !resolvedAncestor.startsWith(`${canonicalRoot}${sep}`)) {
				throw new McpRequestError("MCP stdio working directory must stay inside the workspace.");
			}
			break;
		}
		const parent = dirname(ancestor);
		if (parent === ancestor) {
			throw new McpRequestError("MCP stdio working directory must stay inside the workspace.");
		}
		ancestor = parent;
	}
	return candidate;
}
