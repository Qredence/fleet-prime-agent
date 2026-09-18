/**
 * The stored TypeSafe API key.
 *
 * The only module that touches it. The key lives in the runtime's `auth.json`
 * via `AuthStorage`, which is the right home for three reasons: the runtime
 * creates that file `0600` (and its directory `0700`) and re-applies the mode on
 * every write, whereas a Fleet-owned file would land world-readable; writes are
 * file-locked; and the runtime already keeps a non-provider service credential
 * there itself (Prime Inference), so this is an established pattern rather than
 * a novel use of the store.
 *
 * Nothing in Fleet enumerates `AuthStorage.list()`, so this entry cannot leak
 * into the provider list.
 */
import type { ComposerIntentKeySource } from "@prime-agent/web-protocol/composer-intent";
import type { ApiKeyCredential } from "prime-agent";
import { getPrimeConfig } from "../prime-config";

/** Credential identifier. Not a model provider id, and never resolved as one. */
export const TYPESAFE_CREDENTIAL_ID = "typesafe";

function readCredential(): ApiKeyCredential | undefined {
	try {
		const credential = getPrimeConfig().authStorage.get(TYPESAFE_CREDENTIAL_ID);
		return credential?.type === "api_key" ? credential : undefined;
	} catch {
		// A missing or unreadable store means "no stored key", never a hard failure:
		// the environment variable remains a valid source.
		return undefined;
	}
}

/** The stored key, or `undefined` when none is usable. */
export function readStoredTypeSafeKey(): string | undefined {
	const key = readCredential()?.key?.trim();
	return key ? key : undefined;
}

/** Stores a key, replacing any previous one. */
export function writeStoredTypeSafeKey(key: string): void {
	const trimmed = key.trim();
	if (!trimmed) throw new Error("A TypeSafe API key cannot be empty");
	const config = getPrimeConfig();
	config.authStorage.set(TYPESAFE_CREDENTIAL_ID, { type: "api_key", key: trimmed });
	config.reloadAuth();
}

/** Removes the stored key, letting the environment variable take over again. */
export function clearStoredTypeSafeKey(): void {
	const config = getPrimeConfig();
	if (config.authStorage.has(TYPESAFE_CREDENTIAL_ID)) {
		config.authStorage.remove(TYPESAFE_CREDENTIAL_ID);
	}
	config.reloadAuth();
}

/**
 * Which source the resolved key comes from, for the Settings row.
 *
 * Reports the source only — never the key, not even a masked suffix.
 */
export function typeSafeKeySource(): ComposerIntentKeySource {
	if (readStoredTypeSafeKey()) return "settings";
	if ((process.env.TYPESAFE_API_KEY ?? "").trim()) return "environment";
	return "none";
}
