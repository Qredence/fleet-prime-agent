export const OPENUI_STATE_PREFIX = "fleet.openui.state.v2:";

export function openUIStateSessionPrefix(sessionId: string): string {
	return `${OPENUI_STATE_PREFIX}${encodeURIComponent(sessionId)}:`;
}

/** Remove only the deleted session's forms, including older positional-message keys. */
export function removeSessionOpenUIState(sessionId: string): void {
	try {
		const store = window.localStorage;
		const prefix = openUIStateSessionPrefix(sessionId);
		const legacyPrefix = `fleet.openui.state:${sessionId}-m`;
		for (let index = store.length - 1; index >= 0; index -= 1) {
			const key = store.key(index);
			if (
				key?.startsWith(prefix) ||
				(key?.startsWith(legacyPrefix) && /^\d+:/.test(key.slice(legacyPrefix.length)))
			) {
				store.removeItem(key);
			}
		}
	} catch {
		// Storage may be unavailable; session deletion must still complete.
	}
}
