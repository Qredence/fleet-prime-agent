import { buildMessage, createParser, parseMessage } from "@openuidev/react-lang";
import { openUILibrary } from "@/components/openui/openui-library";
import {
	openUIStateSessionPrefix,
	OPENUI_STATE_PREFIX as STORAGE_PREFIX,
} from "@/components/openui/openui-state-cleanup";

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

const MAX_ENTRIES = 200;
const parser = createParser(openUILibrary.toJSONSchema(), openUILibrary.root);

/** Omit password bindings, including legacy name-based field state. */
function withoutPasswordState(program: string, state: Record<string, unknown>): Record<string, unknown> | undefined {
	const result = parser.parse(program);
	// A partial or invalid tree can conceal a password input. Do not persist or
	// restore anything until the program can be inspected completely.
	if (
		result.meta.incomplete ||
		result.meta.unresolved.length ||
		(!result.root && !result.rootExpression) ||
		result.meta.errors.some((error) => error.severity !== "warning")
	) {
		return undefined;
	}
	const keys = new Set<string>();
	const fieldNames = new Set<string>();
	let uncertain = false;
	const visit = (value: unknown) => {
		if (!value || typeof value !== "object") return;
		if (Array.isArray(value)) {
			for (const item of value) visit(item);
			return;
		}
		const node = value as Record<string, unknown>;
		const props = (
			node.typeName === "Input"
				? node.props
				: node.k === "Comp" && node.name === "Input"
					? node.mappedProps
					: undefined
		) as Record<string, unknown> | undefined;
		if (props) {
			const type = props.type;
			const literalType =
				typeof type === "object" && type !== null && "k" in type && type.k === "Str" && "v" in type ? type.v : type;
			if (literalType === "password" || (literalType != null && typeof literalType !== "string")) {
				const binding = props.value as Record<string, unknown> | undefined;
				const target = binding?.k === "StateRef" ? binding.n : binding?.k === "Assign" ? binding.target : undefined;
				if (typeof target === "string") keys.add(target);
				const name = props.name;
				const literalName =
					typeof name === "object" && name !== null && "k" in name && name.k === "Str" && "v" in name
						? name.v
						: name;
				if (typeof literalName === "string") fieldNames.add(literalName);
				else uncertain = true;
			}
		}
		for (const child of Object.values(node)) visit(child);
	};
	visit(result.root);
	visit(result.rootExpression);
	if (uncertain) return undefined;
	return Object.fromEntries(
		Object.entries(state).flatMap(([key, value]) => {
			if (keys.has(key) || fieldNames.has(key)) return [];
			if (value && typeof value === "object" && !Array.isArray(value)) {
				const fields = Object.entries(value).filter(
					([name, field]) => !fieldNames.has(name) || !field || typeof field !== "object" || !("value" in field),
				);
				return [[key, fields.length === Object.keys(value).length ? value : Object.fromEntries(fields)]];
			}
			return [[key, value]];
		}),
	);
}

function storage(): Storage | undefined {
	try {
		return typeof window === "undefined" ? undefined : window.localStorage;
	} catch {
		// Private mode or a blocked storage partition: state simply does not persist.
		return undefined;
	}
}

function keyFor(sessionKey: string, blockId: string): string {
	return `${openUIStateSessionPrefix(sessionKey)}${blockId}`;
}

/** Encodes form state in the OpenUI message format, so it round-trips through `parseMessage`. */
export function encodeStoredState(program: string, formState: Record<string, unknown>): string {
	return buildMessage({ content: program, context: { formState, savedAt: Date.now() }, end: true });
}

export function decodeStoredState(stored: string): Record<string, unknown> | undefined {
	const parsed = parseMessage(stored);
	const context = parsed.context;
	if (typeof context !== "object" || context === null) return undefined;
	const formState = (context as { formState?: unknown }).formState;
	if (typeof formState !== "object" || formState === null) return undefined;
	return formState as Record<string, unknown>;
}

export function readStoredState(
	sessionKey: string,
	blockId: string,
	program: string,
): Record<string, unknown> | undefined {
	const store = storage();
	if (!store) return undefined;
	const stored = store.getItem(keyFor(sessionKey, blockId));
	if (!stored) return undefined;
	try {
		const state = decodeStoredState(stored);
		if (!state) return undefined;
		if (parseMessage(stored).content !== program) return undefined;
		return withoutPasswordState(program, state);
	} catch {
		return undefined;
	}
}

function pruneOldest(store: Storage) {
	const keys: Array<{ key: string; savedAt: number }> = [];
	for (let index = 0; index < store.length; index += 1) {
		const key = store.key(index);
		if (!key || (!key.startsWith(STORAGE_PREFIX) && !key.startsWith("fleet.openui.state:"))) continue;
		let savedAt = 0;
		try {
			const context = parseMessage(store.getItem(key) ?? "").context as { savedAt?: unknown } | undefined;
			if (typeof context?.savedAt === "number" && Number.isFinite(context.savedAt)) savedAt = context.savedAt;
		} catch {
			// Legacy or corrupt entries are evicted before timestamped entries.
		}
		keys.push({ key, savedAt });
	}
	// Bounded so a long-running session cannot grow storage without limit.
	keys.sort((a, b) => a.savedAt - b.savedAt || a.key.localeCompare(b.key));
	for (const { key } of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) {
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
	let safeState: Record<string, unknown> | undefined;
	try {
		safeState = withoutPasswordState(program, formState);
	} catch {
		// A program that cannot be inspected must not persist form values.
	}
	if (!safeState || Object.keys(safeState).length === 0) {
		store.removeItem(keyFor(sessionKey, blockId));
		return;
	}
	try {
		store.setItem(keyFor(sessionKey, blockId), encodeStoredState(program, safeState));
		pruneOldest(store);
	} catch {
		// Quota or serialization failure: losing interactivity persistence is not
		// worth interrupting the message that is currently rendering.
	}
}
