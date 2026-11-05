/**
 * The stored TypeSafe API key.
 *
 * The only module that touches it. The key lives in the runtime's `auth.json`,
 * which is the right home for three reasons: the runtime creates that file `0600`
 * and re-applies the mode on every write, whereas a Fleet-owned file would land
 * world-readable; Fleet's writer takes a lock and renames atomically; and the
 * runtime already keeps a non-provider service credential there itself (Prime
 * Inference), so this is an established pattern rather than a novel use.
 *
 * Reads and writes go through Fleet's own `auth.json` accessors rather than the
 * SDK's `AuthStorage`, so the same file backs both paths and a Fleet write is
 * never invisible to a subsequent Fleet read.
 *
 * Nothing in Fleet enumerates the file's keys as providers, so this entry cannot
 * leak into the provider list.
 */
import type { ComposerIntentKeySource } from "@prime-agent/web-protocol/composer-intent";
import { readProviderApiKey, removeProviderCredential, setProviderApiKey } from "../agent-auth-store";
import { getPrimeConfig } from "../prime-config";

/** Credential identifier. Not a model provider id, and never resolved as one. */
export const TYPESAFE_CREDENTIAL_ID = "typesafe";

/** The stored key, or `undefined` when none is usable. */
export async function readStoredTypeSafeKey(): Promise<string | undefined> {
	// A missing or unreadable store means "no stored key", never a hard failure:
	// the environment variable remains a valid source.
	const key = await readProviderApiKey(getPrimeConfig().agentDir, TYPESAFE_CREDENTIAL_ID).catch(() => undefined);
	const trimmed = key?.trim();
	return trimmed ? trimmed : undefined;
}

/** Stores a key, replacing any previous one. */
export async function writeStoredTypeSafeKey(key: string): Promise<void> {
	const trimmed = key.trim();
	if (!trimmed) throw new Error("A TypeSafe API key cannot be empty");
	const outcome = await setProviderApiKey(getPrimeConfig().agentDir, TYPESAFE_CREDENTIAL_ID, trimmed);
	if (outcome.status === "refused") throw new Error(outcome.reason);
	getPrimeConfig().reloadAuth();
}

/** Removes the stored key, letting the environment variable take over again. */
export async function clearStoredTypeSafeKey(): Promise<void> {
	const outcome = await removeProviderCredential(getPrimeConfig().agentDir, TYPESAFE_CREDENTIAL_ID);
	if (outcome.status === "refused") throw new Error(outcome.reason);
	getPrimeConfig().reloadAuth();
}

/**
 * Which source the resolved key comes from, for the Settings row.
 *
 * Reports the source only — never the key, not even a masked suffix.
 */
export async function typeSafeKeySource(): Promise<ComposerIntentKeySource> {
	if (await readStoredTypeSafeKey()) return "settings";
	if ((process.env.TYPESAFE_API_KEY ?? "").trim()) return "environment";
	return "none";
}
