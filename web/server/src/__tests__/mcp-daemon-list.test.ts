import { describe, expect, it } from "vitest";
import type { DaemonMcpConnections } from "../daemon-protocol";
import { toMcpConnectionInfoList } from "../mcp-daemon-list";

function payload(overrides: Partial<DaemonMcpConnections> = {}): DaemonMcpConnections {
	return { connections: [], services: [], credentials: [], catalogDiagnostics: [], ...overrides };
}

function service(serviceId: string, status: DaemonMcpConnections["services"][number]["connectionStatus"]) {
	return {
		serviceId,
		label: serviceId.toUpperCase(),
		connectionStatus: status,
		connectable: true,
		addAccountAllowed: null,
		loginPending: null,
		usesOauth: true,
		source: "catalog" as const,
		connectionIds: [serviceId],
		pasteToken: null,
		aliases: null,
		description: null,
		category: null,
		publisher: null,
		docsUrl: null,
		setupHint: null,
		unverified: null,
		verifiedAt: null,
		toolCount: null,
	};
}

describe("daemon MCP list", () => {
	it("reports an expired credential as needs_auth, not connected", () => {
		// This is the bug the daemon view fixes: the SDK list marked a server
		// connected whenever a credential object existed, even when expired.
		const rows = toMcpConnectionInfoList(payload({ services: [service("linear", "not_connected")] }));
		expect(rows[0]).toMatchObject({ name: "linear", status: "needs_auth", enabled: false });
	});

	it("maps each daemon state to a Fleet state without dropping information", () => {
		const rows = toMcpConnectionInfoList(
			payload({
				services: [
					service("a", "connected"),
					service("b", "disabled"),
					service("c", "pending"),
					service("d", "setup_required"),
					service("e", "error"),
					service("f", "not_connected"),
				],
			}),
		);
		const byName = new Map(rows.map((row) => [row.name, row.status]));
		expect(byName.get("a")).toBe("connected");
		expect(byName.get("b")).toBe("disabled");
		// Everything that blocks use reads as needing auth; Fleet has no
		// separate pending/setup state.
		expect(byName.get("c")).toBe("needs_auth");
		expect(byName.get("d")).toBe("needs_auth");
		expect(byName.get("e")).toBe("needs_auth");
		expect(byName.get("f")).toBe("needs_auth");
	});

	it("exposes acceptsPastedToken only where the daemon allows a pasted token", () => {
		const pasteable = { ...service("github", "not_connected"), pasteToken: true };
		const oauthOnly = { ...service("notion", "not_connected"), pasteToken: null };
		const rows = toMcpConnectionInfoList(payload({ services: [pasteable, oauthOnly] }));
		const byName = new Map(rows.map((row) => [row.name, row.acceptsPastedToken]));
		expect(byName.get("github")).toBe(true);
		expect(byName.get("notion")).toBe(false);
	});

	it("keeps a connection that has no matching service card", () => {
		const rows = toMcpConnectionInfoList(
			payload({
				connections: [
					{
						server: "user-server",
						label: "User Server",
						connected: true,
						usesOauth: false,
						authKind: "http",
						transport: "http",
						userDeclared: true,
						generic: false,
					},
				],
			}),
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ name: "user-server", source: "user", status: "connected" });
	});

	it("does not duplicate a server present in both lists", () => {
		const rows = toMcpConnectionInfoList(
			payload({
				services: [service("linear", "connected")],
				connections: [
					{
						server: "linear",
						label: "Linear",
						connected: true,
						usesOauth: true,
						authKind: "subscription",
						transport: "http",
						userDeclared: false,
						generic: false,
					},
				],
			}),
		);
		expect(rows).toHaveLength(1);
	});
});
