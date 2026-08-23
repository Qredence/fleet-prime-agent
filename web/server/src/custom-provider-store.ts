import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { PiCustomProviderApi } from "@prime-agent/web-protocol/chat-protocol";
import {
	isOccFamilyApi,
	isOccProviderId,
	isPiCustomProviderApi,
	OPENAI_CHAT_COMPLETIONS_PROVIDER_ID,
} from "@prime-agent/web-protocol/provider-catalog";

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

function readModelsJsonForWrite(filePath: string): ModelsJson {
	if (!existsSync(filePath)) return {};
	try {
		return parseModelsJson(readFileSync(filePath, "utf-8"));
	} catch (error) {
		throw new Error(
			`Refusing to update models.json because it could not be parsed: ${error instanceof Error ? error.message : error}`,
		);
	}
}

function mergeModelDefinitions(
	existing: Array<{ id: string; [key: string]: unknown }> | undefined,
	incoming: Array<{ id: string; [key: string]: unknown }>,
): Array<{ id: string; [key: string]: unknown }> {
	const existingById = new Map((existing ?? []).map((model) => [model.id, model]));
	const seen = new Set<string>();
	return incoming.flatMap((model) => {
		if (seen.has(model.id)) return [];
		seen.add(model.id);
		return [{ ...existingById.get(model.id), ...model }];
	});
}

export function listCustomProviders(filePath: string): Record<string, StoredCustomProvider> {
	const data = readModelsJson(filePath);
	return data.providers ?? {};
}

function writeModelsJson(filePath: string, data: ModelsJson): void {
	mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
	const serialized = `${JSON.stringify(data, null, "\t")}\n`;
	const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(tmpPath, serialized, "utf-8");
	renameSync(tmpPath, filePath);
}

/**
 * Insert or update a custom-provider entry, preserving fields the UI does not
 * manage (compat, modelOverrides, headers) and entries for other providers.
 */
export function upsertCustomProvider(filePath: string, providerId: string, input: CustomProviderWriteInput): void {
	const data = readModelsJsonForWrite(filePath);
	const providers = { ...(data.providers ?? {}) };
	const existing = providers[providerId] ?? {};
	providers[providerId] = {
		...existing,
		name: input.name ?? existing.name,
		baseUrl: input.baseUrl,
		api: storedApiForCustomProvider(input.api),
		apiKey: input.apiKey,
		models: mergeModelDefinitions(existing.models, input.models),
	};
	writeModelsJson(filePath, { ...data, providers });
}

/** Add discovered model IDs while preserving every existing model definition. */
export function addCustomProviderModelIds(filePath: string, providerId: string, modelIds: Array<string>): void {
	const data = readModelsJsonForWrite(filePath);
	const providers = { ...(data.providers ?? {}) };
	const existing = providers[providerId];
	if (!existing) return;
	providers[providerId] = {
		...existing,
		models: mergeModelDefinitions(existing.models, [...(existing.models ?? []), ...modelIds.map((id) => ({ id }))]),
	};
	writeModelsJson(filePath, { ...data, providers });
}

export function removeCustomProvider(filePath: string, providerId: string): void {
	const data = readModelsJsonForWrite(filePath);
	const providers = data.providers;
	if (!providers || !(providerId in providers)) return;
	const next = { ...providers };
	delete next[providerId];
	writeModelsJson(filePath, { ...data, providers: next });
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
