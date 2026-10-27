import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ImageContent, UserMessage } from "@earendil-works/pi-ai";
import type {
	ChatImagePart,
	ChatMessage,
	ChatPayloadPart,
	ChatToolCategory,
	ChatToolPart,
	FleetErrorEnvelope,
} from "@prime-agent/web-protocol";

/** Convert "ipython" | "bash" | "edit_file" | "read_file" — special-cases IPython + short acronyms. */
function toPascalCase(name: string): string {
	return name
		.split(/[_\-\s]+/g)
		.filter(Boolean)
		.map((w) => {
			if (w.toLowerCase() === "ipython") return "IPython";
			if (w.length <= 3 && /^[a-z]+$/.test(w)) return w.toUpperCase();
			return w.charAt(0).toUpperCase() + w.slice(1);
		})
		.join("");
}

export function categorizeTool(rawName: string): { category: ChatToolCategory; toolName: string; serverName?: string } {
	const lower = rawName.toLowerCase();
	if (lower === "ipython" || lower === "jupyter") {
		return { category: "kernel", toolName: "ipython" };
	}
	if (lower === "bash" || lower === "sh" || lower === "terminal") {
		return { category: "system", toolName: "bash" };
	}
	if (
		lower === "edit" ||
		lower === "edit_file" ||
		lower === "write" ||
		lower === "write_file" ||
		lower === "read" ||
		lower === "read_file" ||
		lower === "glob" ||
		lower === "grep"
	) {
		return { category: "system", toolName: rawName };
	}
	if (lower.startsWith("tool-question") || lower === "question" || lower === "ask_question") {
		return { category: "question", toolName: "ask_question" };
	}
	if (lower.startsWith("plan") || lower.startsWith("todo")) {
		return { category: "plan", toolName: rawName };
	}
	if (lower === "task" || lower === "agent" || lower === "rlm" || lower.startsWith("subagent")) {
		return { category: "rlm", toolName: rawName };
	}
	if (rawName.startsWith("mcp__") || rawName.includes("/")) {
		const parts = rawName.replace(/^mcp__/, "").split(/[_/]/);
		const serverName = parts[0];
		const toolName = parts.slice(1).join("_") || rawName;
		return { category: "mcp", toolName, serverName };
	}
	return { category: "custom", toolName: rawName };
}

export function createFleetErrorEnvelope(
	err: unknown,
	fallbackMessage = "An unexpected error occurred",
): FleetErrorEnvelope {
	const message = typeof err === "string" ? err : err instanceof Error ? err.message : fallbackMessage;
	const lower = message.toLowerCase();

	if (
		lower.includes("auth") ||
		lower.includes("stale") ||
		(lower.includes("token") && (lower.includes("expired") || lower.includes("invalid")))
	) {
		return {
			code: "AUTH_CREDENTIAL_EXPIRED",
			message,
			isTerminal: true,
			remediation: {
				action: "open_settings_tab",
				label: "Re-authenticate in Settings",
			},
		};
	}
	if (lower.includes("rate limit") || lower.includes("429") || lower.includes("quota")) {
		return {
			code: "RATE_LIMIT",
			message,
			isTerminal: false,
			remediation: {
				action: "retry_turn",
				label: "Retry in a moment",
			},
		};
	}
	if (lower.includes("context length") || lower.includes("maximum context") || lower.includes("overflow")) {
		return {
			code: "CONTEXT_OVERFLOW",
			message,
			isTerminal: false,
			remediation: {
				action: "compact_context",
				label: "Compact Context",
			},
		};
	}
	if (lower.includes("kernel") && (lower.includes("died") || lower.includes("crashed") || lower.includes("restart"))) {
		return {
			code: "KERNEL_CRASH",
			message,
			isTerminal: false,
			remediation: {
				action: "restart_kernel",
				label: "Restart IPython Kernel",
			},
		};
	}
	if (lower.includes("timeout") || lower.includes("timed out")) {
		return {
			code: "TOOL_TIMEOUT",
			message,
			isTerminal: false,
			remediation: {
				action: "retry_turn",
				label: "Retry with longer timeout",
			},
		};
	}

	return {
		code: "UNKNOWN_ERROR",
		message,
		isTerminal: false,
	};
}

export function makeToolType(toolName: string): `tool-${string}` {
	if (toolName === "thinking") return "tool-Thinking";
	return `tool-${toPascalCase(toolName)}`;
}

export function isAssistantMessage(msg: AgentMessage): msg is AssistantMessage {
	return (msg as { role?: unknown }).role === "assistant";
}

export function isUserMessage(msg: AgentMessage): msg is UserMessage {
	return (msg as { role?: unknown }).role === "user";
}

export function textFromAssistantMessage(msg: AssistantMessage): string {
	let text = "";
	for (const block of msg.content) {
		if (block.type === "text") text += block.text;
	}
	return text;
}

function getTimestamp(msg: AgentMessage): number | undefined {
	const t = (msg as { timestamp?: unknown }).timestamp;
	return typeof t === "number" ? t : undefined;
}

function imageToChatPart(image: ImageContent): ChatImagePart {
	return {
		type: "image",
		url: `data:${image.mimeType};base64,${image.data}`,
		mimeType: image.mimeType,
	};
}

function contentToChatParts(content: unknown): ChatMessage["parts"] {
	const blocks = typeof content === "string" ? [content] : Array.isArray(content) ? content : [];
	const parts: ChatMessage["parts"] = [];
	for (const block of blocks) {
		if (typeof block === "string") {
			parts.push({ type: "text", text: block });
			continue;
		}
		if (!block || typeof block !== "object") continue;
		const value = block as { type?: unknown; text?: unknown; data?: unknown; mimeType?: unknown };
		if (value.type === "text" && typeof value.text === "string") {
			parts.push({ type: "text", text: value.text });
		} else if (value.type === "image" && typeof value.data === "string" && typeof value.mimeType === "string") {
			parts.push(
				imageToChatPart({
					type: "image",
					data: value.data,
					mimeType: value.mimeType,
				}),
			);
		}
	}
	return parts;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const PRIVATE_PAYLOAD_KEY =
	/(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization|sessionDir|fullOutputPath|harnessStatePath)/i;

export function browserSafePayload(value: unknown, key?: string): unknown {
	if (key && PRIVATE_PAYLOAD_KEY.test(key)) return "[redacted]";
	if (Array.isArray(value)) return value.map((item) => browserSafePayload(item));
	if (isRecord(value)) {
		return Object.fromEntries(
			Object.entries(value).map(([entryKey, entryValue]) => [entryKey, browserSafePayload(entryValue, entryKey)]),
		);
	}
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
		return value;
	}
	return undefined;
}

function stringifyPayload(value: unknown): string {
	if (typeof value === "string") return value;
	if (value === undefined) return "";
	try {
		return JSON.stringify(value, null, 2) ?? "";
	} catch {
		return String(value);
	}
}

export function createPayloadPart(
	kind: string,
	title: string,
	payload: unknown,
	text?: string,
	id?: string,
): ChatPayloadPart {
	const safePayload = browserSafePayload(payload);
	return {
		type: "payload",
		...(id ? { id } : {}),
		kind,
		title,
		...(text ? { text } : {}),
		...(safePayload !== undefined ? { payload: safePayload } : {}),
	};
}

export function textFromChatParts(parts: ChatMessage["parts"]): string {
	return parts
		.filter((part): part is Extract<ChatMessage["parts"][number], { type: "text" }> => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

export function toChatMessageFromRuntimeMessage(message: AgentMessage, id: string): ChatMessage | undefined {
	const value = message as unknown as Record<string, unknown>;
	const role = typeof value.role === "string" ? value.role : "runtime";
	const timestamp = getTimestamp(message);

	if (role === "bashExecution") {
		const command = typeof value.command === "string" ? value.command : "";
		const output = typeof value.output === "string" ? value.output : "";
		const exitCode = typeof value.exitCode === "number" ? value.exitCode : undefined;
		const cancelled = value.cancelled === true;
		const truncated = value.truncated === true;
		const status = cancelled
			? "cancelled"
			: exitCode !== undefined && exitCode !== 0
				? `exit ${exitCode}`
				: "completed";
		const text = [
			`$ ${command}`,
			output,
			truncated ? "Output truncated." : undefined,
			cancelled ? "(cancelled)" : status,
		]
			.filter((part): part is string => Boolean(part))
			.join("\n");
		return {
			id,
			role: "assistant",
			parts: [
				createPayloadPart(
					"bashExecution",
					"Bash",
					{
						command,
						output,
						exitCode,
						cancelled,
						truncated,
						excludeFromContext: value.excludeFromContext === true,
					},
					text,
					id,
				),
			],
			createdAt: timestamp,
		};
	}

	if (role === "custom" && value.display === false) return undefined;

	if (role === "custom") {
		const customType = typeof value.customType === "string" && value.customType ? value.customType : "custom";
		const contentParts = contentToChatParts(value.content);
		const details = browserSafePayload(value.details);
		const payload = {
			customType,
			...(details !== undefined ? { details } : {}),
		};
		return {
			id,
			role: "assistant",
			parts: [
				...contentParts,
				createPayloadPart(
					customType,
					`[${customType}]`,
					payload,
					textFromChatParts(contentParts) ? undefined : stringifyPayload(details),
					id,
				),
			],
			createdAt: timestamp,
		};
	}

	if (role === "branchSummary") {
		const summary = typeof value.summary === "string" ? value.summary : "";
		return {
			id,
			role: "assistant",
			parts: [
				createPayloadPart(
					"branchSummary",
					"Branch summary",
					{ fromId: value.fromId, summary },
					`Branch Summary\n\n${summary}`,
					id,
				),
			],
			createdAt: timestamp,
		};
	}

	if (role === "compactionSummary") {
		const summary = typeof value.summary === "string" ? value.summary : "";
		const tokensBefore = typeof value.tokensBefore === "number" ? value.tokensBefore : undefined;
		const customInstructions = typeof value.customInstructions === "string" ? value.customInstructions : undefined;
		const tokenLabel = tokensBefore === undefined ? "" : `Compacted from ${tokensBefore.toLocaleString()} tokens`;
		return {
			id,
			role: "assistant",
			parts: [
				createPayloadPart(
					"compactionSummary",
					"Compaction summary",
					{ summary, tokensBefore, customInstructions, retainedMessageCount: value.retainedMessageCount },
					[tokenLabel, customInstructions ? `Focus: ${customInstructions}` : undefined, summary]
						.filter((part): part is string => Boolean(part))
						.join("\n\n"),
					id,
				),
			],
			createdAt: timestamp,
		};
	}

	if (role === "user" || role === "assistant" || role === "toolResult") return undefined;

	const contentParts = contentToChatParts(value.content);
	const payload = browserSafePayload(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "content")));
	return {
		id,
		role: "assistant",
		parts: [
			...contentParts,
			createPayloadPart(
				role,
				`[${role}]`,
				payload,
				textFromChatParts(contentParts) ? undefined : stringifyPayload(payload),
				id,
			),
		],
		createdAt: timestamp,
	};
}

export function toChatMessageFromAssistant(msg: AssistantMessage, id: string): ChatMessage {
	const parts: ChatMessage["parts"] = [];
	for (const [contentIndex, block] of msg.content.entries()) {
		const value = block as {
			type: string;
			text?: string;
			data?: string;
			mimeType?: string;
			id?: string;
			name?: string;
			arguments?: unknown;
			thinking?: string;
		};
		if (value.type === "text" && typeof value.text === "string") {
			parts.push({ type: "text", text: value.text });
		} else if (value.type === "thinking" && typeof value.thinking === "string") {
			parts.push({ type: "reasoning", contentIndex, text: value.thinking, state: "complete" });
		} else if (value.type === "image" && value.data && value.mimeType) {
			parts.push(imageToChatPart({ type: "image", data: value.data, mimeType: value.mimeType }));
		} else if (value.type === "toolCall" && value.id && value.name) {
			const { category, toolName, serverName } = categorizeTool(value.name);
			parts.push({
				type: makeToolType(value.name),
				category,
				toolName,
				serverName,
				toolCallId: value.id,
				state: "output-available",
				input: value.arguments,
			} satisfies ChatToolPart);
		}
	}
	const errorMessage = (msg as { errorMessage?: unknown }).errorMessage;
	const stopReason = (msg as { stopReason?: unknown }).stopReason;
	if ((stopReason === "error" || stopReason === "aborted") && typeof errorMessage === "string" && errorMessage) {
		parts.push({
			type: "error",
			title: stopReason === "aborted" ? "Operation aborted" : "Assistant error",
			message: errorMessage,
		});
	}
	return {
		id,
		role: "assistant",
		parts,
		createdAt: getTimestamp(msg),
	};
}

export function toChatMessageFromUser(msg: UserMessage, id: string): ChatMessage {
	return { id, role: "user", parts: contentToChatParts(msg.content), createdAt: getTimestamp(msg) };
}

function toolResultOutput(msg: Record<string, unknown>): Record<string, unknown> {
	const content = contentToChatParts(msg.content);
	return {
		content,
		...(msg.details !== undefined ? { details: msg.details } : {}),
		isError: msg.isError === true,
	};
}

/**
 * Extracts a user-readable error message from a tool result.
 *
 * @param result - The tool result containing error information
 * @returns The extracted error text, or `"Tool execution failed"` when no message is available
 */
export function extractToolErrorText(result: unknown): string {
	if (!result) return "Tool execution failed";
	if (typeof result === "string") return result;
	if (result instanceof Error) return result.message;
	if (typeof result === "object") {
		const rec = result as Record<string, unknown>;
		if (typeof rec.error === "string") return rec.error;
		if (rec.error instanceof Error) return rec.error.message;
		if (typeof rec.stderr === "string") return rec.stderr;
		if (typeof rec.message === "string") return rec.message;
		if (rec.details && typeof rec.details === "object") {
			const det = rec.details as Record<string, unknown>;
			if (typeof det.stderr === "string") return det.stderr;
			if (typeof det.error === "string") return det.error;
			if (typeof det.message === "string") return det.message;
		}
		if (Array.isArray(rec.content)) {
			const texts: Array<string> = [];
			for (const block of rec.content) {
				if (typeof block === "string") {
					if (block.trim()) texts.push(block.trim());
					continue;
				}
				if (block && typeof block === "object") {
					const item = block as { type?: unknown; text?: unknown };
					if (item.type === "text" && typeof item.text === "string" && item.text.trim()) {
						texts.push(item.text.trim());
					}
				}
			}
			if (texts.length > 0) return texts.join("\n");
		}
	}
	return "Tool execution failed";
}

/**
 * Extracts background output from a tool result.
 *
 * @param result - The tool result to inspect
 * @returns The background output string, or `undefined` when none is present
 */
export function extractToolBackgroundOutput(result: unknown): string | undefined {
	if (!result || typeof result !== "object") return undefined;
	const record = result as Record<string, unknown>;
	if (typeof record.backgroundOutput === "string") return record.backgroundOutput;
	if (record.details && typeof record.details === "object") {
		const details = record.details as Record<string, unknown>;
		if (typeof details.backgroundOutput === "string") return details.backgroundOutput;
	}
	return undefined;
}

export function isChatToolPart(part: ChatMessage["parts"][number]): part is ChatToolPart {
	return part.type.startsWith("tool-");
}

/**
 * Hydrates persisted agent messages into canonical chat messages and associates tool results with their calls.
 *
 * @param sessionId - Identifier used to generate stable message IDs.
 * @returns The hydrated chat messages, including standalone tool results when no matching call exists.
 */
export function toChatMessagesFromAgentMessages(
	messages: readonly AgentMessage[],
	sessionId: string,
): Array<ChatMessage> {
	const output: Array<ChatMessage> = [];
	for (const [index, message] of messages.entries()) {
		const role = (message as { role?: unknown }).role;
		const id = `${sessionId}-m${index}`;
		if (role === "assistant") {
			output.push(toChatMessageFromAssistant(message as AssistantMessage, id));
			continue;
		}
		if (role === "user") {
			output.push(toChatMessageFromUser(message as UserMessage, id));
			continue;
		}
		const runtimeMessage = toChatMessageFromRuntimeMessage(message, id);
		if (runtimeMessage) {
			output.push(runtimeMessage);
			continue;
		}
		if (role !== "toolResult") continue;

		const result = message as unknown as Record<string, unknown>;
		const toolCallId = typeof result.toolCallId === "string" ? result.toolCallId : undefined;
		const toolName = typeof result.toolName === "string" ? result.toolName : "tool";
		const isError = result.isError === true;
		const errorText = isError ? extractToolErrorText(result) : undefined;
		const errorEnvelope = errorText ? createFleetErrorEnvelope(errorText) : undefined;
		const durationMs =
			typeof result.durationMs === "number"
				? result.durationMs
				: typeof (result.details as { durationMs?: number })?.durationMs === "number"
					? (result.details as { durationMs: number }).durationMs
					: undefined;
		const backgroundOutput = extractToolBackgroundOutput(result);

		let attached = false;
		if (toolCallId) {
			for (let messageIndex = output.length - 1; messageIndex >= 0 && !attached; messageIndex -= 1) {
				const candidate = output[messageIndex]!;
				const partIndex = candidate.parts.findIndex(
					(part) => isChatToolPart(part) && part.toolCallId === toolCallId,
				);
				if (partIndex < 0) continue;
				const part = candidate.parts[partIndex]!;
				if (!isChatToolPart(part)) continue;
				const nextPart: ChatToolPart = {
					...part,
					state: isError ? "output-error" : "output-available",
					output: toolResultOutput(result),
					result: toolResultOutput(result),
					...(durationMs !== undefined ? { durationMs } : {}),
					...(backgroundOutput !== undefined ? { backgroundOutput } : {}),
					...(errorEnvelope ? { error: errorEnvelope } : {}),
				};
				output[messageIndex] = {
					...candidate,
					parts: candidate.parts.map((item, itemIndex) => (itemIndex === partIndex ? nextPart : item)),
				};
				attached = true;
			}
		}
		if (!attached) {
			output.push({
				id,
				role: "assistant",
				createdAt: typeof result.timestamp === "number" ? result.timestamp : undefined,
				parts: [
					{
						type: makeToolType(toolName),
						...(toolCallId ? { toolCallId } : {}),
						state: isError ? "output-error" : "output-available",
						output: toolResultOutput(result),
						result: toolResultOutput(result),
						...(durationMs !== undefined ? { durationMs } : {}),
						...(backgroundOutput !== undefined ? { backgroundOutput } : {}),
						...(errorEnvelope ? { error: errorEnvelope } : {}),
					},
				],
			});
		}
	}
	return output;
}
