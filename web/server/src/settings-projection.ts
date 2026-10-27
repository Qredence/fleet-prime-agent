import { readFile } from "node:fs/promises";
import { join } from "node:path";

type JsonObject = Record<string, unknown>;

export interface SettingsProjection {
	readonly global: JsonObject;
	readonly project: JsonObject;
	readonly diagnostics: string[];
}

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readSettingsFile(path: string, label: string, diagnostics: string[]): Promise<JsonObject> {
	let content: string;
	try {
		content = await readFile(path, "utf8");
	} catch (error) {
		if (isObject(error) && error.code === "ENOENT") return {};
		diagnostics.push(`Could not read ${label} settings.`);
		return {};
	}

	try {
		const parsed: unknown = JSON.parse(content);
		if (!isObject(parsed)) throw new Error("Settings must be an object");
		return parsed;
	} catch {
		diagnostics.push(`${label[0]?.toUpperCase()}${label.slice(1)} settings are invalid JSON.`);
		return {};
	}
}

/**
 * Read the two documented settings files without invoking SDK migration or
 * write paths. Callers must project only the fields they intend to expose.
 */
export async function readSettingsProjection(agentDir: string, cwd: string): Promise<SettingsProjection> {
	const diagnostics: string[] = [];
	const [global, project] = await Promise.all([
		readSettingsFile(join(agentDir, "settings.json"), "global", diagnostics),
		readSettingsFile(join(cwd, ".prime", "agent", "settings.json"), "project", diagnostics),
	]);
	return { global, project, diagnostics };
}

export function projectSettingsValues(settings: JsonObject): JsonObject {
	const output: JsonObject = {};
	for (const key of [
		"defaultModel",
		"defaultProvider",
		"defaultThinkingLevel",
		"followUpMode",
		"steeringMode",
		"transport",
	] as const) {
		const value = settings[key];
		if (typeof value === "string") output[key] = value;
	}
	if (typeof settings.enableSkillCommands === "boolean") output.enableSkillCommands = settings.enableSkillCommands;
	if (Array.isArray(settings.enabledModels) && settings.enabledModels.every((value) => typeof value === "string")) {
		output.enabledModels = settings.enabledModels;
	}
	for (const key of ["extensions", "prompts", "skills", "themes"] as const) {
		const value = settings[key];
		if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) output[key] = value;
	}
	if (Array.isArray(settings.packages)) {
		const packages: unknown[] = [];
		for (const value of settings.packages) {
			if (typeof value === "string") {
				packages.push(value);
				continue;
			}
			if (!isObject(value) || typeof value.source !== "string") continue;
			const item: JsonObject = { source: value.source };
			for (const key of ["extensions", "skills", "prompts", "themes"] as const) {
				const entries = value[key];
				if (Array.isArray(entries) && entries.every((entry) => typeof entry === "string")) item[key] = entries;
			}
			packages.push(item);
		}
		output.packages = packages;
	}
	for (const key of ["compaction", "retry"] as const) {
		if (!isObject(settings[key])) continue;
		const nested: JsonObject = {};
		const allowed =
			key === "compaction"
				? ["enabled", "reserveTokens", "keepRecentTokens"]
				: ["enabled", "maxRetries", "baseDelayMs"];
		for (const field of allowed) {
			const value = settings[key][field];
			if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) nested[field] = value;
		}
		output[key] = nested;
	}
	return output;
}

export function mergeProjectedSettings(global: JsonObject, project: JsonObject): JsonObject {
	const merged: JsonObject = { ...global, ...project };
	for (const key of ["compaction", "retry"] as const) {
		const globalValue = global[key];
		const projectValue = project[key];
		if (isObject(globalValue) || isObject(projectValue)) {
			merged[key] = {
				...(isObject(globalValue) ? globalValue : {}),
				...(isObject(projectValue) ? projectValue : {}),
			};
		}
	}
	return merged;
}
