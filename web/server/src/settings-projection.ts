import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ChatSettingsResponseSchema } from "@prime-agent/web-protocol/chat-protocol.zod";

type JsonObject = Record<string, unknown>;

export interface SettingsProjection {
	readonly global: JsonObject;
	readonly project: JsonObject;
	readonly diagnostics: string[];
}

/**
 * The response schema is the contract the browser validates against. A single
 * out-of-range value on disk would otherwise reject the whole settings
 * response, so every projected field is narrowed to a shape it already
 * accepts.
 */
const settingsValuesSchema = ChatSettingsResponseSchema.shape.effective;

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Non-empty string constrained by the schema's resource-path bound. */
function isResourcePath(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0 && value.length <= 1024;
}

/** Integer at or above `minimum`, as the schema's int fields require. */
function isIntegerAtLeast(value: unknown, minimum: number): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

function resourcePaths(value: unknown): value is string[] {
	return Array.isArray(value) && value.every(isResourcePath);
}

/** Scalar enum/runtime settings that the schema constrains directly. */
function projectScalarField(output: JsonObject, settings: JsonObject, key: string): void {
	const value = settings[key];
	const field = settingsValuesSchema.shape[key as keyof typeof settingsValuesSchema.shape];
	if (value === undefined || !field) return;
	if (field.safeParse(value).success) output[key] = value;
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
	]) {
		projectScalarField(output, settings, key);
	}
	if (typeof settings.enableSkillCommands === "boolean") output.enableSkillCommands = settings.enableSkillCommands;
	if (Array.isArray(settings.enabledModels) && settings.enabledModels.every(isResourcePath)) {
		output.enabledModels = settings.enabledModels;
	}
	for (const key of ["extensions", "prompts", "skills", "themes"]) {
		const value = settings[key];
		if (resourcePaths(value)) output[key] = value;
	}
	if (Array.isArray(settings.packages)) {
		const packages: unknown[] = [];
		for (const value of settings.packages) {
			if (isResourcePath(value)) {
				packages.push(value);
				continue;
			}
			if (!isObject(value) || !isResourcePath(value.source)) continue;
			const item: JsonObject = { source: value.source };
			for (const key of ["extensions", "skills", "prompts", "themes"]) {
				const entries = value[key];
				if (resourcePaths(entries)) item[key] = entries.map((entry) => entry.trim());
			}
			packages.push(item);
		}
		output.packages = packages;
	}
	// Compaction and retry mix booleans with bounded integers; a wrong type or a
	// non-positive reserve would fail the response schema for the whole payload.
	for (const key of ["compaction", "retry"] as const) {
		if (!isObject(settings[key])) continue;
		const nested: JsonObject = {};
		const allowed =
			key === "compaction"
				? ["enabled", "reserveTokens", "keepRecentTokens"]
				: ["enabled", "maxRetries", "baseDelayMs"];
		for (const field of allowed) {
			const value = settings[key][field];
			if (field === "enabled") {
				if (typeof value === "boolean") nested[field] = value;
				continue;
			}
			// reserveTokens/keepRecentTokens are positive; retry counters may be zero.
			if (isIntegerAtLeast(value, key === "compaction" ? 1 : 0)) nested[field] = value;
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
