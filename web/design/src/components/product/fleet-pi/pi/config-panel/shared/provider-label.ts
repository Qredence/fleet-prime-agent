import { KNOWN_PROVIDERS } from "@prime-agent/web-protocol/provider-catalog";

export function formatProviderLabel(provider: string) {
	return KNOWN_PROVIDERS.find((entry) => entry.id === provider)?.name ?? provider;
}
