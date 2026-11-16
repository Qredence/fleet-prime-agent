import type {
	ChatSessionMetadata,
	ChatStreamEvent,
	FleetErrorCode,
	FleetErrorEnvelope,
	FleetErrorRemediation,
} from "@prime-agent/web-protocol/chat-protocol";
import {
	ChatStreamEventDecodeSchema,
	FleetErrorEnvelopeDecodeSchema,
} from "@prime-agent/web-protocol/chat-protocol.zod";
import type { ZodType } from "zod";
import { resolveChatApiUrl } from "@/lib/chat/chat-runtime-url";

export class ChatStreamContractError extends Error {
	constructor() {
		super(
			"The chat stream received an invalid event. The response may still be running; reload the conversation to refresh it.",
		);
		this.name = "ChatStreamContractError";
	}
}

export class ChatRequestError extends Error {
	readonly status: number;
	readonly body: string;
	readonly code: FleetErrorCode | undefined;
	readonly remediation: FleetErrorRemediation | undefined;

	constructor(status: number, body: string) {
		const envelope = parseErrorEnvelope(body);
		super(envelope?.message || body.trim() || `Request failed (${status})`);
		this.name = "ChatRequestError";
		this.status = status;
		this.body = body;
		this.code = envelope?.code;
		this.remediation = envelope?.remediation;
	}
}

function parseErrorEnvelope(body: string): FleetErrorEnvelope | null {
	try {
		const parsed = FleetErrorEnvelopeDecodeSchema.safeParse(JSON.parse(body));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

export function isForbiddenSessionError(error: unknown) {
	const body = error instanceof ChatRequestError ? error.body : error instanceof Error ? error.message : String(error);
	return body.includes("Session belongs to another user");
}

/** True when the server no longer knows the session (404 from session loads). */
export function isUnknownSessionError(error: unknown): boolean {
	return error instanceof ChatRequestError && error.status === 404;
}

/** True for daemon transport failures, typed (envelope code) or legacy (raw upstream message). */
export function isDaemonDisconnectError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	if ((error as { code?: unknown }).code === "NETWORK_DISCONNECTED") return true;
	return /daemon is not connected/i.test(error.message) || /cannot send daemon command/i.test(error.message);
}

/** Stream error events drop their typed envelope when re-thrown; keep the code attached. */
export function chatErrorFromStreamEvent(event: { message: string; code?: FleetErrorCode }): Error {
	const error = new Error(event.message) as Error & { code?: FleetErrorCode };
	if (event.code) error.code = event.code;
	return error;
}

export async function fetchResponse(url: string, init?: RequestInit): Promise<Response> {
	const resolvedUrl = resolveChatApiUrl(url);
	const headers = new Headers(init?.headers);
	const response = await fetch(resolvedUrl, { ...init, headers });
	if (!response.ok) {
		const body = await response.text();
		throw new ChatRequestError(response.status, body);
	}
	return response;
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
	const response = await fetchResponse(url, init);
	return (await response.json()) as T;
}

export async function fetchValidatedJson<T>(url: string, schema: ZodType<T>, init?: RequestInit): Promise<T> {
	const data = await fetchJson<unknown>(url, init);
	return parseWithSchema(schema, data, `Response from ${url}`);
}

/**
 * Reads newline-delimited chat events from a response stream and delivers them to a callback.
 *
 * @param response - The response containing the chat event stream
 * @param onEvent - Callback invoked for each parsed chat event
 */
export async function readChatStream(response: Response, onEvent: (event: ChatStreamEvent) => void) {
	const reader = response.body?.getReader();
	if (!reader) throw new Error("Chat response did not include a stream");

	const decoder = new TextDecoder();
	let buffer = "";

	// Sequence tracking for critical events to detect reordering/duplication
	const expectedSequenceNumbers = new Map<string, number>();

	/** Track event sequence per session */
	function trackSequence(sessionId: string, eventType: string, seq: number) {
		const current = expectedSequenceNumbers.get(`${sessionId}:${eventType}`) ?? 0;
		if (seq > current + 1) {
			console.warn(
				`[chat-sequence] Gap detected in ${eventType} sequence for session ${sessionId}: ` +
					`expected ${current + 1}, got ${seq}`,
			);
		}
		expectedSequenceNumbers.set(`${sessionId}:${eventType}`, seq);
	}

	const handleLine = (line: string) => {
		const trimmed = line.trim();
		if (!trimmed) return;

		let data: unknown;
		try {
			data = JSON.parse(trimmed) as unknown;
		} catch {
			console.error('[chat-stream] Invalid NDJSON event {"type":"unknown","issues":["invalid_json:[root]"]}');
			throw new ChatStreamContractError();
		}
		const event = parseWithSchema(ChatStreamEventDecodeSchema, data, "Chat stream event");
		const metadata = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : undefined;
		if (typeof metadata?.sessionId === "string" && typeof metadata.sequenceNumber === "number") {
			trackSequence(metadata.sessionId, event.type, metadata.sequenceNumber);
		}
		onEvent(event);
	};

	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			const chunk = decoder.decode(value, { stream: true });
			buffer += chunk;

			let newlineIndex = buffer.indexOf("\n");
			while (newlineIndex >= 0) {
				handleLine(buffer.slice(0, newlineIndex));
				buffer = buffer.slice(newlineIndex + 1);
				newlineIndex = buffer.indexOf("\n");
			}
		}
		buffer += decoder.decode();
		handleLine(buffer);
	} catch (error) {
		await reader.cancel().catch(() => undefined);
		throw error;
	} finally {
		reader.releaseLock();
	}
}

export function parseWithSchema<T>(schema: ZodType<T>, data: unknown, label: string): T {
	const parsed = schema.safeParse(data);
	if (parsed.success) return parsed.data;
	if (label === "Chat stream event" || label === "Subagent chat stream event") {
		const knownTypes = new Set([
			"start",
			"done",
			"error",
			"plan",
			"state",
			"tool",
			"queue",
			"reasoning",
			"reasoning_text",
			"compaction",
			"retry",
			"payload",
			"session_snapshot",
			"delta",
			"message",
			"thinking",
			"presentation",
			"rlm",
		]);
		const knownFields = new Set([
			"type",
			"part",
			"message",
			"messages",
			"parts",
			"id",
			"role",
			"text",
			"state",
			"name",
			"phase",
			"status",
			"sessionId",
			"runId",
			"messageId",
			"toolCallId",
			"toolName",
			"input",
			"output",
			"result",
			"error",
			"code",
			"presentation",
			"revision",
			"sequenceNumber",
			"contentIndex",
			"terminal",
			"session",
			"queue",
			"payload",
			"category",
			"reasoning",
			"steps",
			"durationMs",
			"createdAt",
			"requestKind",
			"data",
			"content",
		]);
		type Issue = { code?: string; path?: PropertyKey[]; errors?: Issue[][] };
		const summarize = (issues: Issue[], prefix: PropertyKey[] = []): string[] =>
			issues.flatMap((issue) => {
				const issuePath = [...prefix, ...(issue.path ?? [])];
				if (issue.code === "invalid_union" && issue.errors) {
					const matching = issue.errors.filter(
						(branch) => !branch.some((entry) => entry.code === "invalid_value" && entry.path?.[0] === "type"),
					);
					return matching.flatMap((branch) => summarize(branch, issuePath));
				}
				const path = issuePath
					.map((key) =>
						typeof key === "number" ? "[]" : typeof key === "string" && knownFields.has(key) ? key : "[field]",
					)
					.join(".");
				return [`${issue.code ?? "invalid"}:${path || "[root]"}`];
			});
		const eventType =
			typeof data === "object" &&
			data !== null &&
			"type" in data &&
			typeof data.type === "string" &&
			knownTypes.has(data.type)
				? data.type
				: "unknown";
		console.error(
			`[chat-stream] Invalid event ${JSON.stringify({ type: eventType, issues: summarize(parsed.error.issues).slice(0, 12) })}`,
		);
		throw new ChatStreamContractError();
	}

	throw new Error(`${label} did not match the expected contract`);
}

export function metadataUrl(metadata: ChatSessionMetadata) {
	const params = new URLSearchParams();
	if (metadata.sessionId) params.set("sessionId", metadata.sessionId);
	if (metadata.projectId) params.set("projectId", metadata.projectId);
	if (metadata.openUI) params.set("openUI", "true");
	return params.toString();
}

/**
 * Mirror of the TUI's working-loader labels. The TUI cycles between
 * "Working", "Waiting", "Thinking", "Writing", "Executing" (a weighted
 * random pick per turn) plus elapsed seconds and token counts. The web port
 * surfaces deterministic labels driven by stream state so the composer
 * loader matches what the agent is actually doing.
 */
export function labelForState(state: ChatStreamEvent["type"] | string) {
	switch (state) {
		case "agent_start":
			return "Working";
		case "turn_start":
			return "Waiting";
		case "message_start":
			return "Thinking";
		case "message_end":
			return "Writing";
		case "tool_start":
		case "tool_execution_start":
		case "tool_execution":
			return "Executing";
		case "tool_end":
		case "tool_execution_end":
			return "Writing";
		case "turn_end":
			return "Turn finished";
		case "agent_end":
			return undefined;
		default:
			return undefined;
	}
}

export type QueueState = {
	steering: Array<string>;
	followUp: Array<string>;
};
