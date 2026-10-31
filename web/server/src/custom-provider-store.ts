import { existsSync, readFileSync } from "node:fs";
import type { PiCustomProviderApi } from "@prime-agent/web-protocol/chat-protocol";
import {
	isOccFamilyApi,
	isOccProviderId,
	isPiCustomProviderApi,
	OPENAI_CHAT_COMPLETIONS_PROVIDER_ID,
} from "@prime-agent/web-protocol/provider-catalog";
import { type JsonObject, updateJsonObjectFile } from "./agent-file-writer";
import { isBuiltInProviderId } from "./builtin-providers";

/**
 * Shape of one custom-provider entry in prime-agent's `models.json`
 * (engine `ModelsConfig.providers[id]`). Unknown fields (compat,
 * modelOverrides, headers, …) are preserved verbatim on upsert.
 */
export type StoredCustomProvider = {
	name?: string;
	baseUrl?: string;
	api?: string;
	/** Engine convention: env var name, `!command`, or (rarely) a literal key. */
	apiKey?: string;
	models?: Array<{ id: string; name?: string; [key: string]: unknown }>;
	[key: string]: unknown;
};

type ModelsJson = {
	providers?: Record<string, StoredCustomProvider>;
	[key: string]: unknown;
};

export type CustomProviderWriteInput = {
	name?: string;
	baseUrl: string;
	api: PiCustomProviderApi;
	/** Stored as the env-var reference name; the secret itself lives in auth.json. */
	apiKey: string;
	models: Array<{ id: string; name?: string; [key: string]: unknown }>;
};

/** Convert the Settings API-family value to the engine's models.json value. */
export function storedApiForCustomProvider(api: PiCustomProviderApi): string {
	return api === "google-genai" ? "google-generative-ai" : api;
}

/** Convert a stored engine API-family value back to the Settings API value. */
export function uiApiForCustomProvider(value: unknown): PiCustomProviderApi | undefined {
	if (value === "google-generative-ai") return "google-genai";
	return isPiCustomProviderApi(value) ? value : undefined;
}

/** Env-var name recorded in models.json for a provider managed via the UI. */
export function envVarNameForManagedProvider(providerId: string): string {
	if (providerId === OPENAI_CHAT_COMPLETIONS_PROVIDER_ID) {
		return "OPENAI_CHAT_COMPLETIONS_API_KEY";
	}
	const slug = providerId
		.slice(providerId.indexOf("+") + 1)
		.toUpperCase()
		.replace(/[^A-Z0-9]+/g, "_");
	return isOccProviderId(providerId) ? `OPENAI_CHAT_COMPLETIONS_${slug}_API_KEY` : `CUSTOM_${slug}_API_KEY`;
}

export function readModelsJson(filePath: string): ModelsJson {
	try {
		if (!existsSync(filePath)) return {};
		return parseModelsJson(readFileSync(filePath, "utf-8"));
	} catch {
		// A corrupt models.json is surfaced through the engine's loader error;
		// the store must not amplify it into the providers API.
		return {};
	}
}

/** Strip `//` line comments and trailing commas from JSON, leaving strings untouched. */
function stripJsonComments(input: string): string {
	return input
		.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*/g, (match) => (match[0] === '"' ? match : ""))
		.replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/g, (match, tail) => tail ?? (match[0] === '"' ? match : ""));
}

function parseModelsJson(raw: string): ModelsJson {
	const parsed = JSON.parse(stripJsonComments(raw)) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("models.json must contain an object");
	}
	return parsed as ModelsJson;
}

const OPENAI_COMPLETIONS_TOOL_REASONING_NONE_PATTERN = /^(?:[^/]+\/)?gpt-(?:5[.-]6|6)(?:[.-]|$)/i;

const OPENAI_COMPLETIONS_REASONING_OFF_MAP = {
	off: "none",
	minimal: null,
	low: null,
	medium: null,
	high: null,
	xhigh: null,
	max: null,
} as const;

function applyModelDefaults(
	model: { id: string; [key: string]: unknown },
	storedApi: string | undefined,
): { id: string; [key: string]: unknown } {
	if (
		storedApi === "openai-completions" &&
		OPENAI_COMPLETIONS_TOOL_REASONING_NONE_PATTERN.test(model.id) &&
		model.reasoning === undefined &&
		model.thinkingLevelMap === undefined
	) {
		return {
			...model,
			reasoning: true,
			thinkingLevelMap: OPENAI_COMPLETIONS_REASONING_OFF_MAP,
		};
	}
	return model;
}

function mergeModelDefinitions(
	existing: Array<{ id: string; [key: string]: unknown }> | undefined,
	incoming: Array<{ id: string; [key: string]: unknown }>,
	storedApi?: string,
): Array<{ id: string; [key: string]: unknown }> {
	const existingById = new Map((existing ?? []).map((model) => [model.id, model]));
	const seen = new Set<string>();
	return incoming.flatMap((model) => {
		if (seen.has(model.id)) return [];
		seen.add(model.id);
		return [applyModelDefaults({ ...existingById.get(model.id), ...model }, storedApi)];
	});
}

export function listCustomProviders(filePath: string): Record<string, StoredCustomProvider> {
	const data = readModelsJson(filePath);
	return data.providers ?? {};
}

/**
 * Custom providers the runtime will refuse to load, because they lack the
 * `apiKey` it requires.
 *
 * The runtime validates a provider as an *override* when its id is a
 * built-in with bundled models, and requires `apiKey` otherwise. Built-in
 * override-only entries (a `baseUrl` with no key) are legal. But one
 * non-built-in provider with a missing or non-string `apiKey` makes it drop
 * **every** custom provider in the file — including well-formed ones listed
 * before it — and reports nothing on any surface: no error field in
 * `get_model_catalog`, no diagnostic in `get_resource_snapshot`, no log line.
 * The only way a user learns why their providers vanished is this check.
 *
 * Returns the offending provider ids, in file order.
 */
export function providersMissingApiKey(filePath: string): string[] {
	return Object.entries(listCustomProviders(filePath))
		.filter(([providerId, entry]) => {
			if (isBuiltInProviderId(providerId)) return false;
			return typeof entry.apiKey !== "string" || entry.apiKey.length === 0;
		})
		.map(([providerId]) => providerId);
}

/**
 * Keep custom-provider reads, merges, and writes under the same per-file lock.
 * `models.json` accepts JSONC, so pass its parser to the shared file writer.
 */
async function updateModelsJson(filePath: string, mutate: (data: ModelsJson) => ModelsJson | undefined): Promise<void> {
	const outcome = await updateJsonObjectFile(
		filePath,
		(current) => {
			const next = mutate(current as ModelsJson);
			return next ? { next: next as JsonObject, result: undefined } : { unchanged: undefined };
		},
		{ mode: 0o644, parse: parseModelsJson },
	);
	if (outcome.status === "refused") {
		throw new Error(`Refusing to update models.json because it could not be parsed: ${outcome.reason}`);
	}
}

function defaultCompatForCustomProvider(
	storedApi: string,
	baseUrl: string,
	existingCompat: unknown,
): Record<string, unknown> | undefined {
	const existingRecord =
		existingCompat && typeof existingCompat === "object" && !Array.isArray(existingCompat)
			? (existingCompat as Record<string, unknown>)
			: undefined;
	if (storedApi !== "openai-completions") {
		return existingRecord;
	}
	try {
		if (new URL(baseUrl).hostname === "api.openai.com") {
			return existingRecord;
		}
	} catch {
		// Non-OpenAI or unparseable baseUrl falls through to disabling store.
	}
	return {
		supportsStore: false,
		...existingRecord,
	};
}

/**
 * Insert or update a custom-provider entry, preserving fields the UI does not
 * manage (compat, modelOverrides, headers) and entries for other providers.
 */
export async function upsertCustomProvider(
	filePath: string,
	providerId: string,
	input: CustomProviderWriteInput,
): Promise<void> {
	await updateModelsJson(filePath, (data) => {
		const providers = { ...(data.providers ?? {}) };
		const existing = providers[providerId] ?? {};
		const storedApi = storedApiForCustomProvider(input.api);
		const compat = defaultCompatForCustomProvider(storedApi, input.baseUrl, existing.compat);
		providers[providerId] = {
			...existing,
			name: input.name ?? existing.name,
			baseUrl: input.baseUrl,
			api: storedApi,
			apiKey: input.apiKey,
			...(compat ? { compat } : {}),
			models: mergeModelDefinitions(existing.models, input.models, storedApi),
		};
		return { ...data, providers };
	});
}

/** Add discovered model IDs while preserving every existing model definition. */
export async function addCustomProviderModelIds(
	filePath: string,
	providerId: string,
	modelIds: Array<string>,
): Promise<void> {
	await updateModelsJson(filePath, (data) => {
		const providers = { ...(data.providers ?? {}) };
		const existing = providers[providerId];
		if (!existing) return;
		const compat =
			typeof existing.api === "string" && typeof existing.baseUrl === "string"
				? defaultCompatForCustomProvider(existing.api, existing.baseUrl, existing.compat)
				: undefined;
		providers[providerId] = {
			...existing,
			...(compat ? { compat } : {}),
			models: mergeModelDefinitions(
				existing.models,
				[...(existing.models ?? []), ...modelIds.map((id) => ({ id }))],
				existing.api,
			),
		};
		return { ...data, providers };
	});
}

export async function removeCustomProvider(filePath: string, providerId: string): Promise<void> {
	await updateModelsJson(filePath, (data) => {
		const providers = data.providers;
		if (!providers || !(providerId in providers)) return;
		const next = { ...providers };
		delete next[providerId];
		return { ...data, providers: next };
	});
}

/** True when the provider entry points at an HTTP(S) endpoint we can discover models from. */
export function isDiscoverableEntry(entry: StoredCustomProvider | undefined): boolean {
	const baseUrl = entry?.baseUrl;
	if (!baseUrl) return false;
	const api = uiApiForCustomProvider(entry?.api);
	if (api && !isOccFamilyApi(api)) return false;
	if (entry?.api && !api) return false;
	try {
		const parsed = new URL(baseUrl);
		return parsed.protocol === "https:" || parsed.protocol === "http:";
	} catch {
		return false;
	}
}
