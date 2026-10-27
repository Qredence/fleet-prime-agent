/**
 * Provider API-key resolution, mirroring the runtime's precedence: a stored
 * `auth.json` credential wins over an environment variable.
 *
 * Replaces the SDK's `ModelRegistry.getApiKeyForProvider`, so model discovery no
 * longer needs a registry instance built from the runtime's model catalog just
 * to read one key.
 *
 * Never returns a value that is not a string; an unreadable store or an absent
 * env var both read as "no key", which callers already treat as unconfigured.
 */
import { readProviderApiKey } from "./agent-auth-store";
import { PRIME_PROVIDER_ENV_MAP } from "./prime-provider-env-map";

/** The env var the runtime would consult for `providerId`, if any. */
export function providerEnvVarName(providerId: string): string | undefined {
	return PRIME_PROVIDER_ENV_MAP[providerId];
}

/**
 * The key to use for `providerId`: the stored credential, else the provider's
 * env var. `undefined` when neither yields a non-empty value.
 */
export async function resolveProviderApiKey(agentDir: string, providerId: string): Promise<string | undefined> {
	const stored = await readProviderApiKey(agentDir, providerId).catch(() => undefined);
	const trimmedStored = stored?.trim();
	if (trimmedStored) return trimmedStored;

	const envVar = providerEnvVarName(providerId);
	if (!envVar) return undefined;
	const fromEnv = (process.env[envVar] ?? "").trim();
	return fromEnv ? fromEnv : undefined;
}
