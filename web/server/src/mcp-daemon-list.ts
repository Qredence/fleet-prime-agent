/**
 * Builds the browser-safe MCP connection list from the Prime Agent daemon.
 *
 * The daemon owns MCP configuration and verification, so its view is the
 * authoritative one. The SDK-backed list being replaced here reported a server as
 * `connected` merely because a credential object existed in `auth.json`; the
 * daemon checks whether the credential is usable, which is why expired tokens
 * now read as `needs_auth` instead of `connected`.
 *
 * The daemon has six connection states and Fleet's wire contract has four, so
 * each mapping is deliberate rather than a passthrough.
 */
import type { McpConnectionInfo, McpConnectionStatus } from "@prime-agent/web-protocol/mcp";
import type { DaemonMcpConnections, DaemonMcpServiceView } from "./daemon-protocol";
import { withTransientDaemonSession } from "./daemon-runtime";

/** Fleet has no separate state for pending or setup, and both block use. */
function toFleetStatus(status: DaemonMcpServiceView["connectionStatus"]): McpConnectionStatus {
	switch (status) {
		case "connected":
			return "connected";
		case "disabled":
			return "disabled";
		case "pending":
		case "not_connected":
		case "setup_required":
		case "error":
			return "needs_auth";
	}
}

/**
 * The daemon serves one row per service, which is closer to what Settings shows
 * than the previous built-in list: it includes servers the runtime knows about
 * but Fleet never hardcoded.
 */
export function toMcpConnectionInfoList(payload: DaemonMcpConnections): McpConnectionInfo[] {
	const rows = new Map<string, McpConnectionInfo>();

	for (const service of payload.services) {
		const status = toFleetStatus(service.connectionStatus);
		const entry = payload.connections.find((candidate) => candidate.server === service.serviceId);
		rows.set(service.serviceId, {
			name: service.serviceId,
			label: service.label,
			source: service.source === "user" ? "user" : "builtin",
			transport: entry?.transport === "stdio" ? "stdio" : "http",
			usesOAuth: service.usesOauth,
			enabled: status === "connected",
			status,
			// `pasteToken` is the daemon's own signal that this server accepts a
			// pasted credential, which is what makes the token endpoint usable.
			acceptsPastedToken: service.pasteToken === true,
		});
	}

	// Connection entries without a matching service card are still real servers;
	// dropping them would hide a working connection.
	for (const connection of payload.connections) {
		if (rows.has(connection.server)) continue;
		const status: McpConnectionStatus = connection.connected ? "connected" : "needs_auth";
		rows.set(connection.server, {
			name: connection.server,
			label: connection.label,
			source: connection.userDeclared ? "user" : "builtin",
			transport: connection.transport === "stdio" ? "stdio" : "http",
			usesOAuth: connection.usesOauth,
			enabled: connection.connected,
			status,
		});
	}

	return [...rows.values()].sort((left, right) => left.label.localeCompare(right.label));
}

/** Lists MCP connections by asking the daemon, which owns the configuration. */
export async function listDaemonMcpConnections(cwd: string): Promise<McpConnectionInfo[]> {
	const payload = await withTransientDaemonSession(cwd, (client, activeSessionId) =>
		client.getMcpConnections(activeSessionId),
	);
	return toMcpConnectionInfoList(payload);
}
