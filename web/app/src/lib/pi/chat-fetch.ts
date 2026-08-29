import type { ChatSessionMetadata, ChatStreamEvent } from "@prime-agent/web-protocol/chat-protocol";
import { ChatStreamEventSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import type { ZodType } from "zod";
import { resolveChatApiUrl } from "@/lib/pi/chat-runtime-url";

// v1 (Fleet Prime web): no auth — local tool bound to 127.0.0.1.
function getChatAuthBearerToken(): string | null {
	return null;
}
function clearChatAuthBearerTokenCache(): void {}

export class ChatRequestError extends Error {
	readonly status: number;
	readonly body: string;

	constructor(status: number, body: string) {
		super(formatChatRequestErrorMessage(status, body));
		this.name = "ChatRequestError";
		this.status = status;
		this.body = body;
	}
}

function formatChatRequestErrorMessage(status: number, body: string) {
	const trimmed = body.trim();
	if (!trimmed) return `Request failed (${status})`;
	try {
		const parsed = JSON.parse(trimmed) as { message?: unknown };
		if (typeof parsed.message === "string" && parsed.message.length > 0) {
			return parsed.message;
		}
	} catch {
		// Keep raw body when the server did not return JSON.
	}
	return trimmed;
}

export function isForbiddenSessionError(error: unknown) {
	const body = error instanceof ChatRequestError ? error.body : error instanceof Error ? error.message : String(error);
	return body.includes("Session belongs to another user");
}

async function withChatRequestHeaders(init?: RequestInit) {
	const headers = new Headers(init?.headers);

	const bearer = await getChatAuthBearerToken();
	if (bearer) {
		headers.set("Authorization", `Bearer ${bearer}`);
	}

	return headers;
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
	const resolvedUrl = resolveChatApiUrl(url);

	const attempt = async (allowRetry: boolean): Promise<T> => {
		const headers = await withChatRequestHeaders(init);
		const response = await fetch(resolvedUrl, { ...init, headers });
		if (response.status === 401 && allowRetry) {
			clearChatAuthBearerTokenCache();
			return attempt(false);
		}
		if (!response.ok) {
			const body = await response.text();
			throw new ChatRequestError(response.status, body);
		}
		return (await response.json()) as T;
	};

	return attempt(true);
}

export async function fetchValidatedJson<T>(url: string, schema: ZodType<T>, init?: RequestInit): Promise<T> {
	const data = await fetchJson<unknown>(url, init);
	return parseWithSchema(schema, data, `Response from ${url}`);
}

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

	// Fast path: JSON.parse without Zod for high-frequency delta events
	const handleLine = (line: string) => {
		const trimmed = line.trim();
		if (!trimmed) return;

		const data = JSON.parse(trimmed) as unknown;
		const eventType =
			typeof data === "object" && data !== null
				? "type" in data && (data as Record<string, unknown>).type
				: undefined;

		// Extract session ID and sequence number for tracking
		const sessionId =
			typeof data === "object" && data !== null && "sessionId" in data ? String((data as any).sessionId) : undefined;
		const sequenceNumber =
			typeof data === "object" && data !== null && "sequenceNumber" in data
				? Number((data as any).sequenceNumber)
				: undefined;

		// Validate only low-frequency events that carry schema-critical structure
		if (
			eventType === "start" ||
			eventType === "done" ||
			eventType === "error" ||
			eventType === "plan" ||
			eventType === "state" ||
			eventType === "tool" ||
			eventType === "queue" ||
			eventType === "reasoning" ||
			eventType === "compaction" ||
			eventType === "retry"
		) {
			const validatedEvent = parseWithSchema(ChatStreamEventSchema, data, "Chat stream event");

			// Track sequence for critical structural events
			if (sessionId && sequenceNumber !== undefined) {
				trackSequence(sessionId, String(validatedEvent.type), sequenceNumber);
			}

			onEvent(validatedEvent);
		} else {
			// Fast path: assume delta and legacy compatibility events are well-formed NDJSON
			onEvent(data as ChatStreamEvent);
		}
	};

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
}

export function parseWithSchema<T>(schema: ZodType<T>, data: unknown, label: string): T {
	const parsed = schema.safeParse(data);
	if (parsed.success) return parsed.data;

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
