import { afterEach, describe, expect, it } from "vitest";
import type { PrimeConfig } from "../prime-config";
import { getPrimeConfig } from "../prime-config";
import { resolveDefaultWorkspaceRoot } from "../workspace-root";

const GLOBAL_KEY = "__primeConfig";

function clearSingleton(): void {
	const globalStore = globalThis as Record<string, unknown>;
	delete globalStore[GLOBAL_KEY];
}

describe("getPrimeConfig", () => {
	afterEach(() => {
		clearSingleton();
	});

	it("recreates a pre-upgrade singleton with the resolved workspace root", () => {
		const preUpgrade = {
			defaultCwd: process.cwd(),
		} as unknown as PrimeConfig;
		const globalStore = globalThis as Record<string, unknown>;
		globalStore[GLOBAL_KEY] = preUpgrade;

		const config = getPrimeConfig();

		expect(config.defaultCwd).toBe(resolveDefaultWorkspaceRoot(process.cwd()));
		expect(typeof config.setDefaultCwd).toBe("function");
	});

	it("returns an already-upgraded singleton as-is", () => {
		const existing = getPrimeConfig();
		const globalStore = globalThis as Record<string, unknown>;
		globalStore[GLOBAL_KEY] = existing;

		const config = getPrimeConfig();

		expect(config).toBe(existing);
		expect(config.defaultCwd).toBe(existing.defaultCwd);
	});
});
