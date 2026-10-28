/**
 * Reads and writes the provider credentials in Prime Agent's `auth.json`.
 *
 * The file is a flat object keyed by provider id (or `mcp:<service>`). Each
 * value is a credential: either an API key or an OAuth bundle. Entries can
 * carry fields Fleet does not model, so an update merges into the existing
 * entry rather than replacing it — writing a key must not drop a provider's
 * `primeTeam` or a still-valid refresh token.
 *
 * Secrets stay inside this module's return values and never appear in an
 * error message or a diagnostic.
 */
import { join } from "node:path";
import { type JsonObject, RUNTIME_FILE_MODE, readJsonObjectFile, updateJsonObjectFile } from "./agent-file-writer";

export const AUTH_FILE = "auth.json";

/** Credentials Fleet may write. OAuth bundles are refreshed by the runtime. */
export type StoredApiKeyCredential = { type: "api_key"; key: string; [field: string]: unknown };

export type CredentialWriteOutcome = { status: "written" } | { status: "refused"; reason: string };

function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function authFilePath(agentDir: string): string {
	return join(agentDir, AUTH_FILE);
}

/**
 * Provider ids key the file, so they must stay plain object keys. Anything
 * with a path separator or control character is rejected rather than written.
 */
export function isWritableProviderId(providerId: string): boolean {
	return providerId.length > 0 && providerId.length <= 128 && !/[\u0000-\u001f/\\]/.test(providerId);
}

/**
 * Whether a provider already has a credential.
 *
 * Deliberately answers a yes/no question: callers that need to show "connected"
 * never handle the secret itself.
 */
export async function hasProviderCredential(agentDir: string, providerId: string): Promise<boolean> {
	const current = await readJsonObjectFile(authFilePath(agentDir));
	if (current.kind !== "ok") return false;
	return isJsonObject(current.value[providerId]);
}

/**
 * The stored API key for `providerId`, or `undefined` when there is no usable
 * api_key credential.
 *
 * Returns the secret, so callers must not log or render it. Prefer
 * {@link hasProviderCredential} when a yes/no answer is enough.
 */
export async function readProviderApiKey(agentDir: string, providerId: string): Promise<string | undefined> {
	const current = await readJsonObjectFile(authFilePath(agentDir));
	if (current.kind !== "ok") return undefined;
	const entry = current.value[providerId];
	if (!isJsonObject(entry) || entry.type !== "api_key") return undefined;
	const key = entry.key;
	return typeof key === "string" ? key : undefined;
}

/**
 * Stores an API key for `providerId`, merging into any existing entry.
 *
 * An existing OAuth bundle keeps its refresh/expiry fields: the runtime can
 * still refresh that provider, and discarding them would silently log the user
 * out of the other auth path.
 */
export async function setProviderApiKey(
	agentDir: string,
	providerId: string,
	key: string,
): Promise<CredentialWriteOutcome> {
	if (!isWritableProviderId(providerId)) {
		return { status: "refused", reason: `"${providerId}" is not a valid provider id.` };
	}
	const trimmed = key.trim();
	if (trimmed.length === 0) {
		return { status: "refused", reason: "The API key is empty." };
	}

	const outcome = await updateJsonObjectFile(
		authFilePath(agentDir),
		(current) => {
			const existing = current[providerId];
			const next: JsonObject = {
				...(isJsonObject(existing) ? existing : {}),
				type: "api_key",
				key: trimmed,
			};
			return { next: { ...current, [providerId]: next }, result: true };
		},
		{ mode: RUNTIME_FILE_MODE },
	);

	return outcome.status === "refused" ? outcome : { status: "written" };
}

/**
 * Every provider id with a credential on disk.
 *
 * Lets callers answer "is this configured?" from the authoritative file rather
 * than a snapshot loaded earlier in the process.
 */
export async function configuredProviderIds(agentDir: string): Promise<Set<string>> {
	const current = await readJsonObjectFile(authFilePath(agentDir));
	if (current.kind !== "ok") return new Set();
	return new Set(
		Object.entries(current.value)
			.filter(([, value]) => isJsonObject(value))
			.map(([providerId]) => providerId),
	);
}

/** Removes the credential for `providerId`, leaving every other entry alone. */
export async function removeProviderCredential(agentDir: string, providerId: string): Promise<CredentialWriteOutcome> {
	const outcome = await updateJsonObjectFile(
		authFilePath(agentDir),
		(current) => {
			if (!(providerId in current)) return { next: current, result: "absent" as const };
			const next: JsonObject = {};
			for (const [currentId, value] of Object.entries(current)) {
				if (currentId !== providerId) next[currentId] = value;
			}
			return { next, result: "removed" as const };
		},
		{ mode: RUNTIME_FILE_MODE },
	);

	return outcome.status === "refused" ? outcome : { status: "written" };
}
