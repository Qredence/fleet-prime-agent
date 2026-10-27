import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mergeProjectedSettings, projectSettingsValues, readSettingsProjection } from "../settings-projection";

const temporaryDirectories: string[] = [];

async function makeTempDir(): Promise<string> {
	const path = await mkdtemp(join(tmpdir(), "fleet-settings-projection-"));
	temporaryDirectories.push(path);
	return path;
}

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Fleet settings projection", () => {
	it("reads global and project config read-only and projects only supported, non-secret fields", async () => {
		const root = await makeTempDir();
		const agentDir = join(root, "agent");
		const cwd = join(root, "project");
		await mkdir(agentDir, { recursive: true });
		await mkdir(join(cwd, ".prime", "agent"), { recursive: true });
		await writeFile(
			join(agentDir, "settings.json"),
			JSON.stringify({
				defaultProvider: "openai",
				defaultModel: "gpt-5",
				compaction: { enabled: false, reserveTokens: 1200, secret: "never expose" },
				mcpServers: { private: { bearerTokenEnvVar: "PRIVATE_TOKEN" } },
				futureRuntimeField: "private",
			}),
		);
		await writeFile(
			join(cwd, ".prime", "agent", "settings.json"),
			JSON.stringify({
				defaultModel: "project-model",
				retry: { enabled: false, maxRetries: 1, provider: { secret: "hide" } },
			}),
		);

		const projection = await readSettingsProjection(agentDir, cwd);
		const global = projectSettingsValues(projection.global);
		const project = projectSettingsValues(projection.project);
		const effective = mergeProjectedSettings(global, project);

		expect(projection.diagnostics).toEqual([]);
		expect(effective.defaultProvider).toBe("openai");
		expect(effective.defaultModel).toBe("project-model");
		expect(effective.compaction).toEqual({ enabled: false, reserveTokens: 1200 });
		expect(effective.retry).toEqual({ enabled: false, maxRetries: 1 });
		expect(JSON.stringify({ global, project, effective })).not.toContain("PRIVATE_TOKEN");
		expect(JSON.stringify({ global, project, effective })).not.toContain("never expose");
		expect(JSON.stringify({ global, project, effective })).not.toContain("futureRuntimeField");
	});

	it("reports malformed files without rewriting them", async () => {
		const root = await makeTempDir();
		const agentDir = join(root, "agent");
		const cwd = join(root, "project");
		await mkdir(agentDir, { recursive: true });
		await mkdir(join(cwd, ".prime", "agent"), { recursive: true });
		const globalPath = join(agentDir, "settings.json");
		await writeFile(globalPath, "{not json");

		const projection = await readSettingsProjection(agentDir, cwd);

		expect(projection.global).toEqual({});
		expect(projection.project).toEqual({});
		expect(projection.diagnostics).toEqual(["Global settings are invalid JSON."]);
		expect(await (await import("node:fs/promises")).readFile(globalPath, "utf8")).toBe("{not json");
	});
});
