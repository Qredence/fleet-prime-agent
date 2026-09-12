import { describe, expect, it } from "vitest";
import { ChatMcpListResponseSchema, ChatMcpUpsertRequestSchema } from "../schemas/mcp";

describe("MCP connection schemas", () => {
	it("accepts a browser-safe connection row and drops secret-shaped extras", () => {
		const parsed = ChatMcpListResponseSchema.parse({
			connections: [
				{
					name: "docs",
					label: "docs",
					source: "user",
					transport: "http",
					url: "https://mcp.example.test/mcp",
					usesOAuth: true,
					enabled: false,
					status: "needs_auth",
					token: "super-secret-token",
					headers: { Authorization: "Bearer super-secret-token" },
				},
			],
		});
		expect(parsed.connections[0]).toMatchObject({
			name: "docs",
			status: "needs_auth",
			usesOAuth: true,
		});
		expect(JSON.stringify(parsed)).not.toContain("super-secret-token");
		expect(JSON.stringify(parsed)).not.toContain("Authorization");
	});

	it("rejects reserved-looking empty names and env values on upsert", () => {
		expect(
			ChatMcpUpsertRequestSchema.safeParse({
				name: "",
				transport: "http",
				url: "https://mcp.example.test/mcp",
			}).success,
		).toBe(false);
		expect(
			ChatMcpUpsertRequestSchema.safeParse({
				name: "shell",
				transport: "stdio",
				command: "uvx",
				env: [{ child: "TOKEN", source: "MCP_TOKEN" }],
			}).success,
		).toBe(true);
		expect(
			ChatMcpUpsertRequestSchema.safeParse({
				name: "shell",
				transport: "stdio",
				command: "uvx",
				env: [{ child: "TOKEN", source: "not valid" }],
			}).success,
		).toBe(false);
	});
});
