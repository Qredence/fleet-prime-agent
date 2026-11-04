import { buildMessage, parseMessage } from "@openuidev/react-lang";

/**
 * Durable form state for rendered OpenUI blocks.
 *
 * OpenUI's renderer holds `$variables` in memory: a reload or a session switch
 * discards whatever the user typed. The 1.0 message format exists for exactly
 * this — the program plus a `context` section carrying `formState` — so the
 * stored value uses `buildMessage`/`parseMessage` rather than a bespoke shape.
 *
 * Storage stays browser-local: form values are per-user, per-session UI state,
 * not runtime data, so they do not belong in the server presentation store or
 * on the wire.
 */

const STORAGE_PREFIX = "fleet.openui.state:";
const MAX_ENTRIES = 200;

function storage(): Storage | undefined {
	try {
		return typeof window === "undefined" ? undefined : window.localStorage;
	} catch {
		// Private mode or a blocked storage partition: state simply does not persist.
		return undefined;
	}
}

function keyFor(sessionKey: string, blockId: string): string {
	return `${STORAGE_PREFIX}${sessionKey}:${blockId}`;
}

/** Encodes form state in the OpenUI message format, so it round-trips through `parseMessage`. */
export function encodeStoredState(program: string, formState: Record<string, unknown>): string {
	return buildMessage({ content: program, context: { formState }, end: true });
}

export function decodeStoredState(stored: string): Record<string, unknown> | undefined {
	const parsed = parseMessage(stored);
	const context = parsed.context;
	if (typeof context !== "object" || context === null) return undefined;
	const formState = (context as { formState?: unknown }).formState;
	if (typeof formState !== "object" || formState === null) return undefined;
	return formState as Record<string, unknown>;
}

export function readStoredState(sessionKey: string, blockId: string): Record<string, unknown> | undefined {
	const store = storage();
	if (!store) return undefined;
	const stored = store.getItem(keyFor(sessionKey, blockId));
	if (!stored) return undefined;
	try {
		return decodeStoredState(stored);
	} catch {
		return undefined;
	}
}

function pruneOldest(store: Storage) {
	const keys: string[] = [];
	for (let index = 0; index < store.length; index += 1) {
		const key = store.key(index);
		if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
	}
	// Bounded so a long-running session cannot grow storage without limit.
	for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) {
		store.removeItem(key);
	}
}

export function writeStoredState(
	sessionKey: string,
	blockId: string,
	program: string,
	formState: Record<string, unknown>,
) {
	const store = storage();
	if (!store) return;
	const isEmpty = Object.keys(formState).length === 0;
	if (isEmpty) {
		store.removeItem(keyFor(sessionKey, blockId));
		return;
	}
	try {
		store.setItem(keyFor(sessionKey, blockId), encodeStoredState(program, formState));
		pruneOldest(store);
	} catch {
		// Quota or serialization failure: losing interactivity persistence is not
		// worth interrupting the message that is currently rendering.
	}
}
