import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { applySettingsPatch } from "../agent-settings-writer";

let dir: string;
let path: string;

async function seed(value: Record<string, unknown>): Promise<void> {
	await writeFile(path, `${JSON.stringify(value, null, "\t")}\n`, "utf8");
}

async function read(): Promise<Record<string, unknown>> {
	return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "fleet-settings-write-"));
	path = join(dir, "settings.json");
});

describe("settings writer", () => {
	it("preserves keys Fleet does not know about", async () => {
		// A newer runtime can add settings; a Fleet write must not drop them.
		await seed({ transport: "auto", agentTraces: true, futureSetting: { nested: [1, 2] } });
		const outcome = await applySettingsPatch(path, { defaultModel: "gpt-5" });
		expect(outcome.status).toBe("written");

		const written = await read();
		expect(written.defaultModel).toBe("gpt-5");
		expect(written.agentTraces).toBe(true);
		expect(written.futureSetting).toEqual({ nested: [1, 2] });
		expect(written.transport).toBe("auto");
	});

	it("merges grouped fields instead of replacing them", async () => {
		await seed({ retry: { enabled: true, maxRetries: 7, baseDelayMs: 900 } });
		await applySettingsPatch(path, { retry: { enabled: false } });

		// Changing one retry field must not reset the others.
		expect(await read()).toMatchObject({ retry: { enabled: false, maxRetries: 7, baseDelayMs: 900 } });
	});

	it("clears a nullable field when the patch passes null", async () => {
		await seed({ enabledModels: ["a/b", "c/d"], transport: "auto" });
		await applySettingsPatch(path, { enabledModels: null });

		const written = await read();
		expect(written).not.toHaveProperty("enabledModels");
		expect(written.transport).toBe("auto");
	});

	it("leaves fields alone when the patch omits them", async () => {
		await seed({ defaultModel: "keep-me", steeringMode: "all" });
		await applySettingsPatch(path, { defaultThinkingLevel: "high" });
		expect(await read()).toMatchObject({ defaultModel: "keep-me", steeringMode: "all" });
	});

	it("reports which consequences follow a write", async () => {
		const stateOnly = await applySettingsPatch(path, { steeringMode: "all" });
		expect(stateOnly.status).toBe("written");
		if (stateOnly.status !== "written") throw new Error("unreachable");
		expect(stateOnly.impact.newSessionRecommended).toBe(false);
		expect(stateOnly.impact.resourceReloadRequired).toBe(false);

		const routing = await applySettingsPatch(path, { defaultProvider: "openrouter" });
		if (routing.status !== "written") throw new Error("unreachable");
		expect(routing.impact.newSessionRecommended).toBe(true);

		const resources = await applySettingsPatch(path, { skills: ["../skills"] });
		if (resources.status !== "written") throw new Error("unreachable");
		expect(resources.impact.resourceReloadRequired).toBe(true);
	});

	it("creates the file when none exists", async () => {
		const outcome = await applySettingsPatch(path, { transport: "auto" });
		expect(outcome.status).toBe("written");
		expect(await read()).toEqual({ transport: "auto" });
	});

	it("refuses rather than discarding an unreadable file", async () => {
		await writeFile(path, "{ this is not json", "utf8");
		const outcome = await applySettingsPatch(path, { transport: "auto" });
		expect(outcome.status).toBe("refused");
		expect(await readFile(path, "utf8")).toBe("{ this is not json");
	});

	it("does not write when the patch changes nothing", async () => {
		await seed({ transport: "auto" });
		const outcome = await applySettingsPatch(path, {});
		expect(outcome.status).toBe("written");
		if (outcome.status !== "written") throw new Error("unreachable");
		expect(outcome.impact.changedKeys).toEqual([]);
	});
});
