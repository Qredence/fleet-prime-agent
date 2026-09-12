import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { confineMcpStdioCwd, dropMcpServerCredentials, listMcpConnections, McpRequestError } from "../mcp-connections";

describe("listMcpConnections", () => {
	it("lists built-ins and sanitizes user servers without leaking secrets", () => {
		const auth = {
			get: (provider: string) =>
				provider === "mcp:linear" ? { type: "oauth", endpoint: "https://other" } : undefined,
			removeVerified: () => undefined,
		};
		const connections = listMcpConnections(
			{
				docs: {
					type: "http",
					url: "https://mcp.example.test/mcp",
					oauth: true,
					headers: { Authorization: "Bearer super-secret-token" },
				} as never,
				shell: {
					type: "stdio",
					command: "uvx",
					args: ["mcp-server"],
					cwd: "/Users/example/project",
					env: { TOKEN: { env: "MCP_TOKEN" } },
				},
			},
			auth,
			{},
		);

		const linear = connections.find((row) => row.name === "linear");
		const docs = connections.find((row) => row.name === "docs");
		const shell = connections.find((row) => row.name === "shell");
		expect(linear).toMatchObject({
			source: "builtin",
			transport: "http",
			usesOAuth: true,
			enabled: true,
			status: "connected",
		});
		expect(docs).toMatchObject({
			source: "user",
			url: "https://mcp.example.test/mcp",
			usesOAuth: true,
			status: "needs_auth",
			enabled: false,
		});
		expect(JSON.stringify(docs)).not.toContain("super-secret-token");
		expect(JSON.stringify(docs)).not.toContain("Authorization");
		expect(shell).toMatchObject({
			transport: "stdio",
			commandPreview: "uvx mcp-server",
			enabled: true,
			status: "connected",
			envBindings: [{ child: "TOKEN", source: "MCP_TOKEN" }],
		});
		expect(JSON.stringify(shell)).not.toContain("secret-value");
	});

	it("treats anonymous HTTP and bearer env as connected without storing tokens", () => {
		const auth = { get: () => undefined, removeVerified: () => undefined };
		const connections = listMcpConnections(
			{
				public: { type: "http", url: "https://mcp.example.test/anon" },
				tokened: {
					type: "http",
					url: "https://mcp.example.test/token",
					bearerTokenEnvVar: "DOCS_MCP_TOKEN",
				},
			},
			auth,
			{ DOCS_MCP_TOKEN: "env-secret" },
		);
		expect(connections.find((row) => row.name === "public")).toMatchObject({
			status: "anonymous",
			enabled: true,
		});
		expect(connections.find((row) => row.name === "tokened")).toMatchObject({
			status: "connected",
			enabled: true,
			bearerTokenEnvVar: "DOCS_MCP_TOKEN",
		});
		expect(JSON.stringify(connections)).not.toContain("env-secret");
	});
});

describe("dropMcpServerCredentials", () => {
	it("does not drop catalog-named built-in credentials", () => {
		const removed: Array<string> = [];
		dropMcpServerCredentials("linear", {
			get: () => undefined,
			removeVerified: (provider) => {
				removed.push(provider);
			},
		});
		expect(removed).toEqual([]);
	});
});

describe("confineMcpStdioCwd", () => {
	it("rejects a cwd that escapes the workspace", async () => {
		const root = mkdtempSync(join(tmpdir(), "mcp-cwd-"));
		try {
			await expect(confineMcpStdioCwd("../escape", root)).rejects.toBeInstanceOf(McpRequestError);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("accepts a workspace-relative cwd", async () => {
		const root = mkdtempSync(join(tmpdir(), "mcp-cwd-ok-"));
		try {
			const confined = await confineMcpStdioCwd("tools", root);
			expect(confined).toBe(join(root, "tools"));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
