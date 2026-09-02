import { KNOWN_PROVIDERS } from "@prime-agent/web-protocol/provider-catalog";

/**
 * Resolves a provider identifier to its display name.
 *
 * @param provider - The provider identifier to format
 * @returns The matching provider name, or the original identifier when no match is found
 */
export function formatProviderLabel(provider: string) {
	return KNOWN_PROVIDERS.find((entry) => entry.id === provider)?.name ?? provider;
}
