import { readStoredValue, removeStoredValue, writeStoredValue } from "@/lib/safe-storage";

export type SseCursor = {
	generation?: string;
	lastEventId: number;
};

export type SseCursorStore = {
	current: () => SseCursor;
	persist: (lastEventId: number, generation?: string) => void;
	setGeneration: (generation?: string) => void;
	reset: (generation?: string) => void;
};

export type SseReconnectingController = {
	connect: () => void;
	reconnectNow: () => void;
	scheduleReconnect: () => void;
	close: () => void;
};

type CreateSseCursorStoreOptions = {
	key: string;
	allowLegacyInteger?: boolean;
	allowZeroLastEventId?: boolean;
	removeWhenNoGeneration?: boolean;
};

function readInitialCursor({
	key,
	allowLegacyInteger = false,
	allowZeroLastEventId = false,
	removeWhenNoGeneration = false,
}: CreateSseCursorStoreOptions): SseCursor {
	const minValidId = allowZeroLastEventId ? 0 : 1;
	const raw = readStoredValue(key, "session");
	if (!raw) return { lastEventId: 0 };

	if (!raw.startsWith("{")) {
		if (!allowLegacyInteger) {
			removeStoredValue(key, "session");
			return { lastEventId: 0 };
		}
		const parsed = Number.parseInt(raw, 10);
		return !Number.isNaN(parsed) && parsed >= minValidId ? { lastEventId: parsed } : { lastEventId: 0 };
	}

	try {
		const parsed = JSON.parse(raw) as { generation?: unknown; lastEventId?: unknown };
		const generation =
			typeof parsed.generation === "string" && parsed.generation.length > 0 ? parsed.generation : undefined;
		const validId =
			typeof parsed.lastEventId === "number" &&
			Number.isInteger(parsed.lastEventId) &&
			parsed.lastEventId >= minValidId
				? parsed.lastEventId
				: 0;
		if (removeWhenNoGeneration && (!generation || validId < minValidId)) {
			removeStoredValue(key, "session");
			return { lastEventId: 0 };
		}
		return { generation, lastEventId: validId };
	} catch {
		if (removeWhenNoGeneration) removeStoredValue(key, "session");
		return { lastEventId: 0 };
	}
}

/** Tracks an SSE stream's generation and sequence cursor in session storage. */
export function createSseCursorStore(options: CreateSseCursorStoreOptions): SseCursorStore {
	let state = readInitialCursor(options);

	const persist = (nextSeq: number, ...generationArg: [generation?: string]) => {
		const nextGeneration = generationArg.length > 0 ? generationArg[0] || undefined : state.generation;
		state = { generation: nextGeneration, lastEventId: nextSeq };
		if (nextGeneration) {
			writeStoredValue(options.key, JSON.stringify({ generation: nextGeneration, lastEventId: nextSeq }), "session");
			return;
		}
		if (options.removeWhenNoGeneration) {
			removeStoredValue(options.key, "session");
			return;
		}
		writeStoredValue(options.key, String(nextSeq), "session");
	};

	const setGeneration = (generation?: string) => {
		state = { ...state, generation };
	};

	const reset = (...generationArg: [generation?: string]) => {
		if (generationArg.length > 0) {
			persist(0, generationArg[0]);
			return;
		}
		persist(0);
	};

	return {
		current: () => state,
		persist,
		setGeneration,
		reset,
	};
}

/** Parses an SSE `lastEventId` header into a positive sequence number when valid. */
export function parseSseEventId(lastEventId: string | undefined): number | undefined {
	if (!lastEventId) return undefined;
	const parsed = Number.parseInt(lastEventId, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

type SseErrorContext = {
	attempt: number;
	scheduleReconnect: () => void;
	close: () => void;
};

type CreateReconnectingEventSourceOptions = {
	getUrl: () => string;
	canConnect?: () => boolean;
	onOpen?: () => void;
	onMessage: (data: unknown, lastEventId: number | undefined, context: { reconnected: boolean }) => void;
	onMalformedJson: () => void;
	onError?: (context: SseErrorContext) => void;
};

/**
 * Manages a single active `EventSource` with stale-instance guards, JSON frame
 * parsing, exponential backoff reconnects, and permanent teardown.
 */
export function createReconnectingEventSource({
	getUrl,
	canConnect,
	onOpen,
	onMessage,
	onMalformedJson,
	onError,
}: CreateReconnectingEventSourceOptions): SseReconnectingController {
	let source: EventSource | null = null;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let reconnectAttempt = 0;
	let closed = false;

	const clearReconnectTimer = () => {
		if (!reconnectTimer) return;
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	};

	const close = () => {
		closed = true;
		clearReconnectTimer();
		source?.close();
		source = null;
	};

	const canContinue = () => !closed && (!canConnect || canConnect());

	const scheduleReconnect = () => {
		if (!canContinue()) return;
		reconnectAttempt += 1;
		clearReconnectTimer();
		reconnectTimer = setTimeout(connect, Math.min(2_000, 250 * 2 ** Math.min(reconnectAttempt, 3)));
	};

	const handleFailure = () => {
		if (!canContinue()) return;
		source?.close();
		source = null;
		if (onError) {
			onError({ attempt: reconnectAttempt + 1, scheduleReconnect, close });
			return;
		}
		scheduleReconnect();
	};

	function connect() {
		if (!canContinue()) return;
		if (typeof window === "undefined" || typeof EventSource === "undefined") return;
		source?.close();
		let nextSource: EventSource;
		try {
			nextSource = new EventSource(getUrl());
		} catch {
			handleFailure();
			return;
		}
		source = nextSource;

		const isCurrent = () => canContinue() && source === nextSource;
		nextSource.onopen = () => {
			if (!isCurrent()) return;
			reconnectAttempt = 0;
			onOpen?.();
		};
		nextSource.onmessage = (event) => {
			// Browser EventSource implementations can still dispatch queued events after close().
			if (!isCurrent()) return;
			const reconnected = reconnectAttempt > 0;
			if (reconnected) reconnectAttempt = 0;
			const seq = parseSseEventId(event.lastEventId);
			let parsed: unknown;
			try {
				parsed = JSON.parse(event.data) as unknown;
			} catch {
				onMalformedJson();
				return;
			}
			onMessage(parsed, seq, { reconnected });
		};
		nextSource.onerror = () => {
			if (!isCurrent()) return;
			handleFailure();
		};
	}

	const reconnectNow = () => {
		if (!canContinue()) return;
		clearReconnectTimer();
		reconnectAttempt = 0;
		connect();
	};

	return {
		connect,
		reconnectNow,
		scheduleReconnect,
		close,
	};
}
