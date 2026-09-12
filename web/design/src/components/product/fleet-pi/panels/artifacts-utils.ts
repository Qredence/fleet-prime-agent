import type { ChatMessage } from "@prime-agent/web-protocol/chat-types";
import { segmentOpenUIContent } from "../../../openui/openui-utils";

export type SessionOpenUIBlock = {
	/** Stable id: `${messageId}:${segmentId}` — matches chat-rendered block ids. */
	blockId: string;
	/** DSL source of the block (without the markdown fence). */
	content: string;
	component: string;
	/** 1-based position across the session's assistant messages. */
	ordinal: number;
};

const ROOT_COMPONENT_PATTERN = /^root\s*=\s*([A-Za-z][A-Za-z0-9]*)/;
const FIRST_STRING_LITERAL_PATTERN = /"((?:\\.|[^"\\]){1,80})"/;

/** Human label for a block: card/heading titles if present, else the root component. */
export function openUIBlockLabel(content: string): string {
	return FIRST_STRING_LITERAL_PATTERN.exec(content)?.[1] ?? ROOT_COMPONENT_PATTERN.exec(content)?.[1] ?? "Interface";
}

/**
 * Extract generative-UI blocks (openui DSL segments) from session messages,
 * in chronological order. Shared between the chat renderer and the artifacts
 * panel so both see the exact same blocks for a session.
 */
export function collectSessionOpenUIBlocks(messages: ReadonlyArray<ChatMessage>): Array<SessionOpenUIBlock> {
	const blocks: Array<SessionOpenUIBlock> = [];
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		for (const part of message.parts) {
			if (part.type !== "text" || typeof part.text !== "string") continue;
			for (const segment of segmentOpenUIContent(part.text)) {
				if (segment.type !== "openui") continue;
				blocks.push({
					blockId: `${message.id}:${segment.id}`,
					content: segment.content,
					component: openUIBlockLabel(segment.content),
					ordinal: blocks.length + 1,
				});
			}
		}
	}
	return blocks;
}
