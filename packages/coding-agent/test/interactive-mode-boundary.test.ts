import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = dirname(fileURLToPath(import.meta.url));
const sourceDir = join(testDir, "../src");

async function readSource(relativePath: string): Promise<string> {
	return readFile(join(sourceDir, relativePath), "utf8");
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function expectNoImports(source: string, forbiddenModules: readonly string[]): void {
	for (const modulePath of forbiddenModules) {
		expect(source, `unexpected import from ${modulePath}`).not.toMatch(
			new RegExp(`from\\s+["']${escapeRegExp(modulePath)}["']`),
		);
	}
}

function expectNoValueImports(source: string, forbiddenModules: readonly string[]): void {
	for (const modulePath of forbiddenModules) {
		// Allow `import type { ... } from "..."` — type-only coupling is fine for
		// the connection contract. Forbid value imports that would pull runtime.
		expect(source, `unexpected value import from ${modulePath}`).not.toMatch(
			new RegExp(`import\\s+(?!type\\b)[^;]*from\\s+["']${escapeRegExp(modulePath)}["']`),
		);
	}
}

describe("InteractiveMode execution boundary", () => {
	it("does not import core runtimes, sessions, session managers, or daemon transports", async () => {
		const source = await readSource("modes/interactive/interactive-mode.ts");

		expectNoImports(source, [
			"../../core/agent-session.js",
			"../../core/agent-session-runtime.js",
			"../../core/session-manager.js",
			"../agent-connection/daemon-agent-connection.js",
			"../agent-connection/in-process-agent-connection.js",
			"../daemon/daemon-client.js",
			"../daemon/daemon-mode.js",
			"../daemon/daemon-protocol.js",
			"../daemon/daemon-socket.js",
		]);
	});

	it("keeps local runtime/session value imports out of the generic connection contract", async () => {
		const source = await readSource("modes/agent-connection/types.ts");

		expectNoValueImports(source, [
			"../../core/agent-session.js",
			"../../core/agent-session-runtime.js",
			"../../core/session-manager.js",
			"../daemon/daemon-client.js",
			"../daemon/daemon-protocol.js",
			"../daemon/daemon-socket.js",
		]);
		expectNoImports(source, [
			"../../core/agent-session.js",
			"../../core/agent-session-runtime.js",
			"../daemon/daemon-client.js",
			"../daemon/daemon-protocol.js",
			"../daemon/daemon-socket.js",
		]);
		expect(source).toContain("Transitional note");
		expect(source).toContain("not the final hosted/gateway wire protocol");
	});
});
