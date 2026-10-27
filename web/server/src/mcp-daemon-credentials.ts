/**
 * MCP credential writes through the Prime Agent daemon.
 *
 * These commands are session-scoped even though MCP configuration is not:
 * `set_mcp_static_token` and `remove_mcp_connection` both require an
 * `activeSessionId`. Fleet's MCP pane is project-global, so each write borrows a
 * short-lived resident session (see `withTransientDaemonSession`) and disposes
 * it afterwards.
 *
 * Writes go through the daemon rather than editing `mcp-connections.json`
 * directly: the daemon owns that file's format and its verification step.
 */
import { withTransientDaemonSession } from "./daemon-runtime";

export type McpCredentialOutcome =
	| { status: "stored"; verified: boolean; toolCount: number | null; error?: string }
	| { status: "removed"; removed: boolean }
	| { status: "refused"; reason: string };

/**
 * Stores a pasted token for one MCP server.
 *
 * A daemon refusal (unknown server, server that does not accept a pasted token,
 * empty token) rejects the command; a failed *verification* is still a
 * successful store and comes back as `verified: false` with a fixed error
 * category, so the credential is saved and the caller can show why it did not
 * verify.
 */
export async function storeMcpStaticToken(cwd: string, server: string, token: string): Promise<McpCredentialOutcome> {
	const trimmed = token.trim();
	if (trimmed.length === 0) return { status: "refused", reason: "The token is empty." };
	try {
		const result = await withTransientDaemonSession(cwd, (client, activeSessionId) =>
			client.setMcpStaticToken(activeSessionId, server, trimmed),
		);
		return {
			status: "stored",
			verified: result.verified,
			toolCount: result.toolCount,
			...(result.error ? { error: result.error } : {}),
		};
	} catch (error) {
		return { status: "refused", reason: errorMessage(error) };
	}
}

/** Removes one MCP connection's credential and record. */
export async function removeMcpConnection(cwd: string, server: string): Promise<McpCredentialOutcome> {
	try {
		const result = await withTransientDaemonSession(cwd, (client, activeSessionId) =>
			client.removeMcpConnection(activeSessionId, server),
		);
		return { status: "removed", removed: result.removed };
	} catch (error) {
		return { status: "refused", reason: errorMessage(error) };
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
