/**
 * Applies a settings patch to a Prime Agent `settings.json` file.
 *
 * Prime Agent owns this file's format, so the writer is deliberately additive:
 * it merges the requested fields into whatever is on disk and preserves every
 * key it does not understand. A setting Fleet has never heard of, or one a
 * newer runtime added, survives a Fleet write untouched.
 *
 * Fields the runtime groups (compaction, retry) merge field-by-field, so
 * changing `retry.enabled` does not reset `retry.maxRetries`.
 */
import type { ChatPiSettingsUpdate } from "@prime-agent/web-protocol/chat-protocol";
import { RUNTIME_FILE_MODE, updateJsonObjectFile } from "./agent-file-writer";

type JsonObject = Record<string, unknown>;

/**
 * Fields whose values are read when a session starts. Changing one leaves
 * running sessions on their previous configuration.
 */
const NEW_SESSION_FIELDS = new Set([
	"compaction",
	"defaultModel",
	"defaultProvider",
	"defaultThinkingLevel",
	"enableSkillCommands",
	"enabledModels",
	"retry",
	"transport",
]);

/**
 * Fields that load code or resources into the runtime. Changing one requires a
 * reload before the change is observable.
 */
const RESOURCE_FIELDS = new Set(["extensions", "packages", "prompts", "skills", "themes"]);

/** Grouped fields that merge field-by-field instead of replacing wholesale. */
const MERGED_FIELDS = new Set(["compaction", "retry"]);

export type SettingsWriteImpact = {
	readonly changedKeys: string[];
	readonly newSessionRecommended: boolean;
	readonly resourceReloadRequired: boolean;
};

export type SettingsWriteOutcome =
	| { status: "written"; impact: SettingsWriteImpact }
	| { status: "refused"; reason: string };

function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The patch with its explicitly-undefined fields removed. */
function definedFields(patch: ChatPiSettingsUpdate): JsonObject {
	const output: JsonObject = {};
	for (const [key, value] of Object.entries(patch)) {
		if (value !== undefined) output[key] = value;
	}
	return output;
}

/** Removes a key, used to honour an explicit `null`. */
function withoutKey(settings: JsonObject, key: string): JsonObject {
	const next: JsonObject = {};
	for (const [current, value] of Object.entries(settings)) {
		if (current !== key) next[current] = value;
	}
	return next;
}

/**
 * Writes `patch` into `settingsPath`.
 *
 * `null` clears a nullable field (`enabledModels`), `undefined` means "leave
 * it alone", and every other value replaces what is on disk.
 */
export async function applySettingsPatch(
	settingsPath: string,
	patch: ChatPiSettingsUpdate,
): Promise<SettingsWriteOutcome> {
	const fields = definedFields(patch);
	const changedKeys = Object.keys(fields);
	if (changedKeys.length === 0) {
		return {
			status: "written",
			impact: { changedKeys, newSessionRecommended: false, resourceReloadRequired: false },
		};
	}

	const outcome = await updateJsonObjectFile(
		settingsPath,
		(current) => {
			let next = current;
			for (const [key, value] of Object.entries(fields)) {
				if (value === null) {
					next = withoutKey(next, key);
					continue;
				}
				if (MERGED_FIELDS.has(key) && isJsonObject(value)) {
					const existing = next[key];
					next = { ...next, [key]: { ...(isJsonObject(existing) ? existing : {}), ...value } };
					continue;
				}
				next = { ...next, [key]: value };
			}
			return { next, result: changedKeys };
		},
		{ mode: RUNTIME_FILE_MODE },
	);

	if (outcome.status === "refused") return outcome;
	return {
		status: "written",
		impact: {
			changedKeys: outcome.value,
			newSessionRecommended: changedKeys.some((key) => NEW_SESSION_FIELDS.has(key)),
			resourceReloadRequired: changedKeys.some((key) => RESOURCE_FIELDS.has(key)),
		},
	};
}
