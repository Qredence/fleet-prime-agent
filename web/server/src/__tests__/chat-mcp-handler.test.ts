import { describe, expect, it, vi } from "vitest";
import {
	handleChatMcpDelete,
	handleChatMcpGet,
	handleChatMcpOAuthPost,
	handleChatMcpPost,
	type McpHandlerDeps,
} from "../handlers/chat-mcp";
import type { FleetMcpServerConfig } from "../mcp-connections";

function createDeps(initial: Record<string, FleetMcpServerConfig> = {}): {
	deps: McpHandlerDeps;
	servers: Record<string, FleetMcpServerConfig>;
	removed: Array<string>;
} {
	const servers: Record<string, FleetMcpServerConfig> = { ...initial };
	const credentials = new Map<string, { type: string; endpoint?: string }>();
	const removed: Array<string> = [];
	const deps: McpHandlerDeps = {
		getUserServers: () => ({ ...servers }),
		setUserServer: (name, config) => {
			servers[name] = config;
		},
		removeUserServer: (name) => {
			if (!(name in servers)) return false;
			delete servers[name];
			return true;
		},
		flushSettings: async () => undefined,
		auth: {
			get: (provider) => credentials.get(provider),
			removeVerified: (provider) => {
				removed.push(provider);
				credentials.delete(provider);
			},
		},
		workspaceRoot: "/workspace",
		env: {},
		reloadAuth: vi.fn(),
		reloadResources: vi.fn(async () => undefined),
	};
	return { deps, servers, removed };
}

describe("MCP connection handlers", () => {
	it("lists built-in catalog servers", async () => {
		const { deps } = createDeps();
		const response = await handleChatMcpGet(new Request("http://localhost/api/chat/mcp"), deps);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { connections: Array<{ name: string; source: string }> };
		expect(body.connections.map((row) => row.name)).toEqual(expect.arrayContaining(["linear", "notion"]));
		expect(body.connections.filter((row) => row.source === "builtin").length).toBeGreaterThan(0);
	});

	it("rejects reserved catalog names on add", async () => {
		const { deps } = createDeps();
		const response = await handleChatMcpPost(
			new Request("http://localhost/api/chat/mcp", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "linear",
					transport: "http",
					url: "https://mcp.example.test/mcp",
					oauth: true,
				}),
			}),
			deps,
		);
		expect(response.status).toBe(400);
		const body = (await response.json()) as { message: string };
		expect(body.message).toMatch(/reserved/i);
	});

	it("drops stored credentials when adding a user server", async () => {
		const { deps, servers, removed } = createDeps();
		const response = await handleChatMcpPost(
			new Request("http://localhost/api/chat/mcp", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "docs",
					transport: "http",
					url: "https://mcp.example.test/mcp",
					oauth: true,
				}),
			}),
			deps,
		);
		expect(response.status).toBe(200);
		expect(servers.docs).toMatchObject({ type: "http", url: "https://mcp.example.test/mcp", oauth: true });
		expect(removed).toEqual(["mcp:docs"]);
		expect(deps.reloadResources).toHaveBeenCalled();
		const body = (await response.json()) as { connections: Array<{ name: string }> };
		expect(body.connections.some((row) => row.name === "docs")).toBe(true);
	});

	it("does not drop built-in credentials when deleting a catalog-named shadow", async () => {
		const { deps, removed } = createDeps({
			linear: { type: "http", url: "https://mcp.example.test/linear", oauth: true },
		});
		const response = await handleChatMcpDelete(
			new Request("http://localhost/api/chat/mcp", {
				method: "DELETE",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ name: "linear" }),
			}),
			deps,
		);
		expect(response.status).toBe(200);
		expect(removed).toEqual([]);
	});

	it("rejects a stdio cwd that escapes the workspace", async () => {
		const { deps } = createDeps();
		const response = await handleChatMcpPost(
			new Request("http://localhost/api/chat/mcp", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "shell",
					transport: "stdio",
					command: "uvx",
					cwd: "../escape",
					force: true,
				}),
			}),
			deps,
		);
		expect(response.status).toBe(400);
		const body = (await response.json()) as { message: string };
		expect(body.message).toMatch(/working directory/i);
		expect(body.message).not.toContain("escape");
	});

	it.each(["login", "reconnect"] as const)(
		"returns terminal guidance for %s without changing credentials",
		async (action) => {
			const { deps, removed } = createDeps();
			const response = await handleChatMcpOAuthPost(
				new Request("http://localhost/api/chat/mcp/oauth", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ name: "linear", action, promptAnswer: "sensitive-user-input" }),
				}),
				deps,
			);

			expect(response.status).toBe(501);
			const body = (await response.json()) as { status: string; error?: string; loginId?: string };
			expect(body.status).toBe("error");
			expect(body.error).toContain("Launch Prime Agent in a terminal");
			expect(body.error).toContain("same configuration directory as Fleet");
			expect(body.error).toContain("Restart Fleet");
			expect(body.error).not.toContain("sensitive-user-input");
			expect(body).not.toHaveProperty("loginId");
			expect(removed).toEqual([]);
			expect(deps.reloadAuth).not.toHaveBeenCalled();
			expect(deps.reloadResources).not.toHaveBeenCalled();
		},
	);

	it("logs out stored credentials and returns the refreshed list", async () => {
		const { deps, removed } = createDeps();
		deps.auth.get = () => ({ type: "oauth", endpoint: "https://mcp.linear.app/mcp" });
		const response = await handleChatMcpOAuthPost(
			new Request("http://localhost/api/chat/mcp/oauth", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ name: "linear", action: "logout" }),
			}),
			deps,
		);
		expect(response.status).toBe(200);
		expect(removed).toEqual(["mcp:linear"]);
		const body = (await response.json()) as { status: string; connections?: Array<{ name: string }> };
		expect(body.status).toBe("success");
		expect(body.connections?.some((row) => row.name === "linear")).toBe(true);
	});
});
